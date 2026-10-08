const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { mediaView, sliderTarget, formatTime } = require('../lib/media')
const script = fs.readFileSync(require.resolve('../../app/src/main/assets/media_control.js'), 'utf8')
function video(extra = {}) {
  return Object.assign({ currentTime: 25, duration: 100, paused: false, ended: false, readyState: 4,
    currentSrc: 'https://private.example/video', seekable: { length: 1, start: () => 0, end: () => 100 },
    getBoundingClientRect: () => ({ width: 800, height: 450 }), ownerDocument: {},
    pause() { this.paused = true }, play() { this.paused = false; return Promise.resolve() } }, extra)
}
function browser(media = [], elements = []) {
  const document = { querySelectorAll: selector => selector === 'video, audio' ? media : elements }
  const context = vm.createContext({ window: {}, document })
  const control = vm.runInContext(script, context)
  return (action = 'mediaStatus', seconds = null, id = null, deadline = Date.now() + 1500) =>
    JSON.parse(JSON.stringify(control(action, seconds, id, deadline)))
}
test('relative and absolute seeking use actual media position and clamp video boundaries', () => {
  const media = video(), control = browser([media]), id = control().mediaId
  assert.equal(control('seekBy', 10, id).position, 35)
  assert.equal(control('seekBy', -10, id).position, 25)
  assert.equal(control('seekTo', 500, id).position, 100)
  assert.equal(control('seekBy', -600, id).position, 0)
  assert.equal(control('seekTo', 55.5, id).position, 55.5)
  assert.equal(control('mediaToggle', null, id).paused, true)
  assert.equal(control('mediaToggle', null, id).paused, false)
  assert.equal(media.currentTime, 55.5)
})
test('status contains timing only and does not expose private video addresses', () => {
  const result = browser([video()])()
  assert.equal(result.available, true)
  assert.equal(result.canSeek, true)
  assert.equal(result.duration, 100)
  assert.equal(JSON.stringify(result).includes('private.example'), false)
})
test('empty page, unloaded media and live streams never allow seeking', () => {
  assert.deepEqual(browser()(), { available: false })
  for (const duration of [Infinity, NaN, 0]) {
    const media = video({ duration }), control = browser([media]), state = control()
    assert.equal(state.duration, null)
    assert.equal(state.canSeek, false)
    assert.equal(control('seekTo', 50, state.mediaId).error, 'media_not_seekable')
    assert.equal(media.currentTime, 25)
  }
  assert.equal(browser([video({ seekable: { length: 0 } })])().canSeek, false)
})
test('disjoint seekable ranges choose the closest valid endpoint', () => {
  const media = video({ seekable: { length: 2, start: i => [5, 60][i], end: i => [30, 90][i] } })
  const control = browser([media]), id = control().mediaId
  assert.equal(control('seekTo', 50, id).position, 60)
  assert.equal(control('seekTo', 35, id).position, 30)
  assert.equal(control('seekTo', 0, id).position, 5)
})
test('source changes, tab changes and expired commands cannot seek the new video', () => {
  const media = video(), control = browser([media]), id = control().mediaId
  media.currentSrc = 'another-video'
  assert.equal(control('seekTo', 80, id).error, 'media_changed')
  assert.equal(browser([video()])('seekTo', 80, id).error, 'media_changed')
  assert.equal(control('seekBy', 10, control().mediaId, Date.now() - 1).error, 'not_ready')
  assert.equal(media.currentTime, 25)
})
test('playing media wins over an earlier idle element; same-origin frames and shadow roots work', () => {
  const idle = video({ paused: true }), active = video({ currentTime: 66 })
  assert.equal(browser([idle, active])().position, 66)
  const root = { querySelectorAll: selector => selector === 'video, audio' ? [active] : [] }
  assert.equal(browser([], [{ tagName: 'IFRAME', contentDocument: root }])().position, 66)
  assert.equal(browser([], [{ tagName: 'DIV', shadowRoot: root }])().position, 66)
  assert.equal(browser([], [{ tagName: 'IFRAME', get contentDocument() { throw Error('cross origin') } }])().available, false)
})
test('visible or fullscreen video wins over hidden background media', () => {
  const hidden = video({ currentTime: 90, getBoundingClientRect: () => ({ width: 0, height: 0 }) })
  const main = video({ currentTime: 40, paused: true })
  assert.equal(browser([hidden, main])().position, 40)
  hidden.ownerDocument.fullscreenElement = hidden
  assert.equal(browser([hidden, main])().position, 90)
})
test('slider formatting handles long videos and invalid or live duration', () => {
  assert.equal(formatTime(3661), '1:01:01')
  assert.equal(formatTime(Infinity), '--:--')
  const view = mediaView({ available: true, mediaId: 'a', position: 30, duration: 100, canSeek: true, seekStart: 10, seekEnd: 90 })
  assert.equal(view.slider, 250)
  assert.equal(view.currentLabel, '0:30')
  assert.equal(sliderTarget(500, view), 50)
  assert.equal(sliderTarget(2000, view), 90)
  assert.equal(mediaView({ ...view, seekEnd: 101 }).canSeek, false)
  assert.equal(mediaView({ ...view, duration: null }).canSeek, false)
})

function page() {
  let definition
  const toasts = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/remote/remote.js'), 'utf8'), {
    require: path => path.endsWith('/media') ? require('../lib/media') : path.endsWith('/volume') ? require('../lib/volume') : {},
    Page: value => { definition = value }, wx: { showToast: toast => toasts.push(toast) },
    setTimeout, clearTimeout, setInterval, clearInterval, Date
  })
  const calls = []
  definition.setData = data => {
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('media.')) definition.data.media[key.slice(6)] = value
      else definition.data[key] = value
    }
  }
  definition.data.connected = true
  definition.mediaPollEpoch = 1
  definition.mediaRevision = 1
  definition.client = { canRequest: () => true, request: async (op, fields) => { calls.push({ op, fields }); return { media: current() } } }
  function current(id = 'a', position = 25) {
    return { available: true, mediaId: id, position, duration: 100, canSeek: true, seekStart: 0, seekEnd: 100, paused: false }
  }
  definition.updateMedia(current())
  return { page: definition, calls, current, toasts }
}
test('dragging previews locally and sends exactly one seek when released', async () => {
  const { page: p, calls, current } = page()
  p.seekStart()
  p.seekChanging({ detail: { value: 500 } })
  p.updateMedia(current('a', 26))
  assert.equal(p.data.media.currentLabel, '0:50')
  assert.equal(calls.length, 0)
  await p.seekChange({ detail: { value: 600 } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].op, 'seekTo')
  assert.equal(calls[0].fields.seconds, 60)
  assert.equal(calls[0].fields.mediaId, 'a')
})
test('switching video or disconnecting during a drag cancels the seek', async () => {
  const { page: p, calls, current } = page()
  p.seekStart()
  p.updateMedia(current('b'))
  await p.seekChange({ detail: { value: 600 } })
  p.seekStart()
  p.stopMediaPolling()
  await p.seekChange({ detail: { value: 600 } })
  assert.equal(calls.length, 0)
})
test('tapping the slider without changing its value does not freeze future progress updates', async () => {
  const { page: p, calls, current } = page()
  p.seekStart()
  p.seekEnd()
  await new Promise(resolve => setTimeout(resolve, 550))
  p.updateMedia(current('a', 30))
  assert.equal(p.data.media.position, 30)
  assert.equal(calls.length, 0)
})
test('late status replies cannot overwrite the position returned by a seek', async () => {
  const { page: p, current } = page()
  let resolveStatus
  p.mediaSupported = true
  p.client.request = op => op === 'mediaStatus' ? new Promise(resolve => { resolveStatus = resolve }) : Promise.resolve({ media: current('a', 70) })
  p.startMediaPolling()
  await p.mediaCommand('seekTo', { seconds: 70 }, 'a')
  resolveStatus({ media: current('a', 20) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(p.data.media.position, 70)
  p.stopMediaPolling()
})
test('a seek error recovers without replaying and an old connection cannot update the UI', async () => {
  const { page: p, calls, toasts, current } = page()
  p.client.request = async () => { calls.push('seek'); throw Object.assign(Error('视频已变化'), { code: 'media_changed' }) }
  await p.mediaCommand('seekTo', { seconds: 50 }, 'a')
  assert.equal(calls.length, 1)
  assert.equal(p.data.mediaBusy, false)
  assert.equal(toasts.length, 1)
  let resolveSeek
  p.client.request = () => new Promise(resolve => { resolveSeek = resolve })
  const pending = p.mediaCommand('seekTo', { seconds: 50 }, 'a')
  p.stopMediaPolling()
  resolveSeek({ media: current('a', 50) })
  await pending
  assert.equal(p.data.media.available, false)
})
test('fullscreen requires a supported TV and ignores repeated taps while a command is pending', async () => {
  const { page: p, calls, toasts } = page()
  await p.toggleFullscreen()
  assert.equal(calls.length, 0)
  assert.match(toasts[0].title, /更新电视浏览器/)
  p.fullscreenSupported = true
  let resolve
  p.client.request = op => { calls.push(op); return new Promise(done => { resolve = done }) }
  const pending = p.toggleFullscreen()
  await p.toggleFullscreen()
  assert.deepEqual(calls, ['toggleFullscreen'])
  assert.equal(p.data.fullscreenBusy, true)
  resolve({ fullscreen: true })
  await pending
  assert.equal(p.data.fullscreenBusy, false)
})

function qualityState(current, id = 'a', optionId = 'q-2') {
  return { ...current(id), quality: { supported: true, options: [{ id: 'q-1', label: '自动' },
    { id: optionId, label: '720P' }], selectedId: 'q-1', currentHeight: 360 } }
}
test('quality choices send one command with the media and catalog snapshot', async () => {
  const { page: p, calls, current } = page()
  p.updateMedia(qualityState(current)); p.chooseQuality()
  assert.equal(p.data.qualityChoices.length, 2)
  await p.setQuality({ currentTarget: { dataset: { id: 'q-2', mediaId: 'a' } } })
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { op: 'setQuality', fields: { qualityId: 'q-2', mediaId: 'a' } })
  assert.equal(calls.length, 1)
  assert.equal(p.data.qualityChoices.length, 0)
})
test('changed video, options and disconnect close the quality menu without sending stale choices', async () => {
  for (const change of [(p, current) => p.updateMedia(qualityState(current, 'b')),
    (p, current) => p.updateMedia(qualityState(current, 'a', 'q-new')), p => p.stopMediaPolling()]) {
    const { page: p, calls, current } = page()
    p.updateMedia(qualityState(current)); p.chooseQuality(); change(p, current)
    assert.equal(p.data.qualityChoices.length, 0)
    await p.setQuality({ currentTarget: { dataset: { id: 'q-2', mediaId: 'a' } } })
    assert.equal(calls.length, 0)
  }
})
test('old server has an update hint and loading a new source disables competing controls', async () => {
  const { page: p, calls, current } = page()
  p.qualitySupported = false; p.updateMedia(current())
  assert.match(p.data.media.quality.hint, /更新电视/)
  const loading = qualityState(current); loading.quality.switching = true
  p.updateMedia(loading); p.chooseQuality(); p.seekStart()
  await p.toggleMedia(); await p.skipMedia({ currentTarget: { dataset: { seconds: 10 } } })
  assert.equal(p.seekSnapshot, null); assert.equal(p.data.qualityChoices.length, 0); assert.equal(calls.length, 0)
})
