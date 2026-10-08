const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const mediaScript = fs.readFileSync(require.resolve('../../app/src/main/assets/media_control.js'), 'utf8')
const qualityScript = fs.readFileSync(require.resolve('../../app/src/main/assets/media_quality.js'), 'utf8')
const { qualityView } = require('../lib/media')

function browser({ paused = false, sources = [] } = {}) {
  const listeners = {}, timers = new Map()
  const view = { setTimeout(fn) { const key = {}; timers.set(key, fn); return key },
    clearTimeout(key) { timers.delete(key) } }
  const media = { tagName: 'VIDEO', currentTime: 25, duration: 100, paused, ended: false, readyState: 4,
    currentSrc: 'https://private.example/360.mp4', src: 'https://private.example/360.mp4', videoHeight: 360,
    seekable: { length: 1, start: () => 0, end: () => 100 }, isConnected: true,
    getBoundingClientRect: () => ({ width: 800, height: 450 }), ownerDocument: { defaultView: view },
    querySelectorAll: () => sources, canPlayType: () => 'probably',
    addEventListener(name, fn) { (listeners[name] ||= new Set()).add(fn) },
    removeEventListener(name, fn) { listeners[name]?.delete(fn) },
    emit(name) { for (const fn of Array.from(listeners[name] || [])) fn() },
    load() { this.loads = (this.loads || 0) + 1; this.duration = NaN; this.paused = true },
    play() { this.plays = (this.plays || 0) + 1; this.paused = false; return Promise.resolve() },
    pause() { this.paused = true } }
  const document = { querySelectorAll: selector => selector === 'video, audio' ? [media] : [] }
  const context = vm.createContext({ window: view, document })
  const controller = vm.runInContext(mediaScript, context), quality = vm.runInContext(qualityScript, context)
  const control = (action = 'mediaStatus', mediaId = null, qualityId = null, deadline = Date.now() + 1500) =>
    JSON.parse(JSON.stringify(controller(action, null, mediaId, deadline, qualityId, quality)))
  const select = option => { const state = control(); return control('setQuality', state.mediaId,
    state.quality.options.find(choice => choice.label === option).id) }
  return { media, view, timers, control, select }
}
function hls(b) {
  const levels = [{ height: 360, bitrate: 500000, url: ['https://private.example/low.m3u8'] },
    { height: 1080, bitrate: 4000000, url: ['https://private.example/high.m3u8'] }]
  const player = { media: b.media, levels, manualLevel: -1, autoLevelEnabled: true, _current: 0,
    get currentLevel() { return this._current }, set currentLevel(value) {
      this._current = value; this.manualLevel = value; this.autoLevelEnabled = value === -1
    } }
  b.view.hls = player
  return player
}
function source(height, type = 'video/mp4', url = `https://private.example/${height}.mp4`) {
  return { src: url, getAttribute: name => ({ 'data-res': String(height), type })[name] || null }
}
function youtube(b, host = 'www.youtube.com') {
  b.view.location = { hostname: host }
  const player = { levels: ['hd1080', 'hd720', 'medium', 'auto'], videoId: 'private-video', calls: [],
    ads: false, classList: { contains: () => player.ads }, contains: media => media === b.media,
    getVideoData: () => ({ video_id: player.videoId }), getAvailableQualityLevels: () => player.levels,
    setPlaybackQualityRange: (...args) => player.calls.push(args) }
  b.media.closest = selector => selector === '.html5-video-player' ? player : null
  return player
}

test('YouTube uses only the active DOM player range API and keeps requested and actual quality separate', () => {
  const b = browser({ paused: true }), player = youtube(b), before = b.control()
  assert.deepEqual(before.quality.options.map(o => o.label), ['自动', '1080P', '720P', '360P'])
  assert.equal(before.quality.selectedId, '')
  const result = b.select('720P')
  assert.deepEqual(player.calls, [['hd720', 'hd720']])
  assert.equal(result.quality.selectedId, result.quality.options[2].id)
  assert.equal(result.quality.currentHeight, 360)
  b.media.videoHeight = 720
  assert.equal(b.control().quality.currentHeight, 720)
  assert.equal(b.control().position, 25)
  assert.equal(b.media.paused, true)
  assert.equal(b.media.loads, undefined)
  assert.equal(b.media.plays, undefined)
  assert.equal(JSON.stringify(result).includes('private'), false)
  b.select('自动')
  assert.deepEqual(player.calls[1], ['auto', 'auto'])
  assert.equal(b.control().quality.selectedId, before.quality.options[0].id)
})
test('YouTube rejects menus from a previous video even if the media element and blob URL are reused', () => {
  const b = browser(), player = youtube(b), before = b.control()
  player.videoId = 'different-video'
  assert.equal(b.control('setQuality', before.mediaId, before.quality.options[1].id).error, 'quality_changed')
  assert.equal(player.calls.length, 0)
  assert.equal(b.control().quality.selectedId, '')
})
test('YouTube recognizes only trusted hosts and the player containing this video, and excludes ads', () => {
  for (const host of ['www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com']) {
    const b = browser(); youtube(b, host)
    assert.equal(b.control().quality.supported, true)
  }
  for (const change of [
    (b, p) => { b.view.location.hostname = 'youtube.com.evil.example' },
    (b, p) => { b.view.location.hostname = 'notyoutube.com' },
    (b, p) => { p.contains = () => false },
    (b, p) => { p.ads = true },
    (b, p) => { p.setPlaybackQualityRange = undefined },
    (b, p) => { p.getVideoData = () => ({}) }
  ]) {
    const b = browser(), player = youtube(b); change(b, player)
    assert.equal(b.control().quality.supported, false)
    assert.equal(player.calls.length, 0)
  }
})
test('YouTube filters unknown tiers, deduplicates choices, and invalidates a changed catalog', () => {
  const b = browser(), player = youtube(b)
  player.levels = ['medium', 'unknown', 'medium']
  const before = b.control()
  assert.deepEqual(before.quality.options.map(o => o.label), ['自动', '360P'])
  player.levels.push('hd720')
  assert.equal(b.control('setQuality', before.mediaId, before.quality.options[1].id).error, 'quality_changed')
  const next = b.control()
  player.levels.reverse()
  assert.deepEqual(b.control().quality.options, next.quality.options)
})
test('broken YouTube APIs preserve progress and report a failed selection instead of success', () => {
  const b = browser(), player = youtube(b), before = b.control()
  player.setPlaybackQualityRange = () => { throw Error('broken') }
  assert.equal(b.control('setQuality', before.mediaId, before.quality.options[1].id).error, 'quality_failed')
  assert.equal(b.control().quality.selectedId, '')
  player.getAvailableQualityLevels = () => { throw Error('not ready') }
  assert.equal(b.control().quality.supported, false)
  assert.equal(b.control().canSeek, true)
})

test('HLS quality switches and automatic mode leave time intact and do not expose source URLs', () => {
  const b = browser(), player = hls(b), before = b.control()
  assert.deepEqual(before.quality.options.map(o => o.label), ['自动', '1080P', '360P'])
  const result = b.select('1080P')
  assert.equal(player.currentLevel, 1)
  assert.equal(result.position, 25)
  assert.equal(result.quality.currentHeight, 360) // Requested quality is not falsely reported as decoded quality.
  assert.equal(result.quality.selectedId, result.quality.options[1].id)
  assert.equal(b.select('自动').quality.selectedId, before.quality.options[0].id)
  assert.equal(player.manualLevel, -1)
  assert.equal(JSON.stringify(result).includes('private.example'), false)
})
test('an HLS instance attached to another video is never controlled', () => {
  const b = browser(), player = hls(b)
  player.media = {}
  assert.equal(b.control().quality.supported, false)
  assert.equal(b.control('setQuality', b.control().mediaId, 'fake').error, 'quality_unsupported')
  assert.equal(player.manualLevel, -1)
})
test('changed quality catalog, player instance, video source and expired commands reject old selections', () => {
  const b = browser(), player = hls(b), state = b.control(), id = state.quality.options[1].id
  player.levels[1].url = ['https://private.example/next-video.m3u8']
  assert.equal(b.control('setQuality', state.mediaId, id).error, 'quality_changed')
  const next = b.control()
  hls(b)
  assert.equal(b.control('setQuality', next.mediaId, next.quality.options[1].id).error, 'quality_changed')
  const latest = b.control()
  assert.equal(b.control('setQuality', latest.mediaId, latest.quality.options[1].id, Date.now() - 1).error, 'not_ready')
  b.media.currentSrc = 'https://private.example/new.mp4'
  assert.equal(b.control('setQuality', latest.mediaId, latest.quality.options[1].id).error, 'media_changed')
  assert.equal(b.view.hls.manualLevel, -1)
})
test('Video.js quality levels switch only the player containing the selected video', () => {
  const b = browser(), levels = [{ id: 'a', height: 360, enabled: true }, { id: 'b', height: 720, enabled: true }]
  b.view.videojs = { getPlayers: () => ({ irrelevant: { el: () => ({ contains: () => false }) },
    main: { el: () => ({ contains: media => media === b.media }), qualityLevels: () => levels } }) }
  b.select('720P')
  assert.deepEqual(levels.map(l => l.enabled), [false, true])
  b.select('自动')
  assert.deepEqual(levels.map(l => l.enabled), [true, true])
})
test('broken optional player APIs never disable progress control', () => {
  const b = browser()
  Object.defineProperty(b.media, 'hls', { get() { throw Error('broken') } })
  b.view.videojs = { getPlayers() { throw Error('broken') } }
  const state = b.control()
  assert.equal(state.quality.supported, false)
  assert.equal(state.canSeek, true)
})
test('explicit MP4 variants restore position and playing state after metadata, not before', () => {
  const b = browser({ sources: [source(360), source(720)] })
  assert.equal(b.select('720P').quality.switching, true)
  assert.equal(b.media.src, 'https://private.example/720.mp4')
  assert.equal(b.media.loads, 1)
  assert.equal(b.media.plays, undefined)
  const pending = b.control()
  assert.equal(pending.quality.switching, true)
  assert.equal(b.control('setQuality', pending.mediaId, pending.quality.options[0].id).error, 'quality_busy')
  assert.equal(b.control('mediaToggle', pending.mediaId).error, 'quality_busy')
  b.media.currentSrc = b.media.src; b.media.duration = 100; b.media.currentTime = 0; b.media.videoHeight = 720
  b.media.emit('loadedmetadata')
  assert.equal(b.media.currentTime, 25)
  assert.equal(b.media.paused, false)
  assert.equal(b.media.plays, 1)
  assert.equal(b.timers.size, 0)
  const done = b.control()
  assert.equal(done.quality.switching, false)
  assert.equal(done.quality.currentHeight, 720)
  assert.equal(JSON.stringify(done).includes('private.example'), false)
})
test('a paused direct source stays paused and position clamps to the new duration', () => {
  const b = browser({ paused: true, sources: [source(360), source(720)] })
  b.select('720P')
  b.media.currentSrc = b.media.src; b.media.duration = 20; b.media.currentTime = 0
  b.media.emit('loadedmetadata')
  assert.equal(b.media.currentTime, 20)
  assert.equal(b.media.paused, true)
  assert.equal(b.media.plays, undefined)
})
test('source errors and timeouts clear pending operations and never auto-resume later', () => {
  for (const fail of [b => b.media.emit('error'), b => Array.from(b.timers.values())[0]()]) {
    const b = browser({ sources: [source(360), source(720)] })
    b.select('720P')
    b.media.currentSrc = b.media.src; b.media.duration = 100
    fail(b)
    assert.equal(b.control().quality.failed, true)
    b.media.emit('loadedmetadata')
    assert.equal(b.media.plays, undefined)
    assert.equal(b.timers.size, 0)
  }
})
test('a source load failure remains visible when no metadata or duration ever arrives', () => {
  const b = browser({ sources: [source(360), source(720)] })
  b.select('720P'); b.media.emit('error')
  assert.equal(b.control().quality.failed, true)
  assert.equal(b.control().quality.failed, true)
  assert.match(qualityView(b.control().quality).hint, /切换失败/)
})
test('source navigation and detached videos cancel restoration instead of seeking a new video', () => {
  for (const change of [b => { b.media.src = 'https://private.example/other.mp4' }, b => { b.media.isConnected = false }]) {
    const b = browser({ sources: [source(360), source(720)] })
    b.select('720P'); change(b)
    b.media.duration = 100; b.media.currentTime = 0; b.media.emit('loadedmetadata')
    assert.equal(b.media.currentTime, 0)
    assert.equal(b.media.plays, undefined)
    assert.equal(b.timers.size, 0)
  }
})
test('codec alternatives, encrypted media, unlabelled sources and unrelated blob streams are not guessed', () => {
  const cases = [
    [source(360), source(360, 'video/webm')],
    [source(360), source('高清')],
    [source(360), source(720, 'application/vnd.apple.mpegurl')],
    [source(360), source(720, 'video/mp4', 'javascript:alert(1)')]
  ]
  for (const sources of cases) assert.equal(browser({ sources }).control().quality.supported, false)
  const encrypted = browser({ sources: [source(360), source(720)] }); encrypted.media.mediaKeys = {}
  assert.equal(encrypted.control().quality.supported, false)
  const blob = browser({ sources: [source(360), source(720)] }); blob.media.currentSrc = 'blob:opaque'
  assert.equal(blob.control().quality.supported, false)
})
test('same-origin iframe uses its own player registry', () => {
  const b = browser(); hls(b)
  const document = { querySelectorAll: selector => selector === '*' ? [{ tagName: 'IFRAME',
    contentDocument: { querySelectorAll: s => s === 'video, audio' ? [b.media] : [] } }] : [] }
  const context = vm.createContext({ window: {}, document })
  const result = vm.runInContext(`(${mediaScript})('mediaStatus', null, null, Date.now() + 1500, null, (${qualityScript}))`, context)
  assert.equal(result.quality.supported, true)
})
test('quality view validates choices and distinguishes requested from actual resolution', () => {
  const view = qualityView({ supported: true, options: [{ id: 'q-1', label: '自动' }, { id: 'q-2', label: '1080P' }],
    selectedId: 'q-2', currentHeight: 360 })
  assert.equal(view.selectedLabel, '1080P'); assert.equal(view.currentLabel, '360P')
  assert.equal(qualityView({ supported: true, options: [{ id: 'url://evil', label: 'x' }] }).supported, false)
  assert.equal(qualityView({ supported: true, options: [{ id: 'a', label: 'a' }, { id: 'a', label: 'b' }] }).supported, false)
  assert.match(qualityView({ reason: 'engine_unsupported' }).hint, /WebView/)
})
