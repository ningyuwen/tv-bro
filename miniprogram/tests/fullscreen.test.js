const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const script = fs.readFileSync(require.resolve('../../app/src/main/assets/fullscreen_control.js'), 'utf8')
function browser() {
  const handlers = new Map(), timers = new Set()
  const window = {
    innerHeight: 1080, innerWidth: 1920, focus() {},
    addEventListener(type, fn) { handlers.set(type, fn) },
    removeEventListener(type, fn) { if (handlers.get(type) === fn) handlers.delete(type) }
  }
  const videos = [], elements = []
  const document = { defaultView: window, querySelectorAll: selector => selector === 'video' ? videos : elements }
  const context = vm.createContext({ window, document, setTimeout(fn, ms) {
    const timer = setTimeout(fn, ms); timers.add(timer); return timer
  }, clearTimeout })
  const control = vm.runInContext(script, context)
  function run(action = 'prepare', token = 'a', deadline = Date.now() + 1000) {
    return JSON.parse(JSON.stringify(control(action, token, deadline)))
  }
  function video(extra = {}) {
    const media = Object.assign({ ownerDocument: document, currentSrc: 'video', isConnected: true,
      paused: false, ended: false, getBoundingClientRect: () => ({ width: 800, height: 450, bottom: 450, right: 800, top: 0, left: 0 }),
      requestFullscreen() { document.fullscreenElement = this; return Promise.resolve() }
    }, extra)
    videos.push(media)
    return media
  }
  function key(type, extra = {}) {
    const fn = handlers.get(type)
    if (fn) fn(Object.assign({ key: 'F8', isTrusted: true, preventDefault() {}, stopImmediatePropagation() {} }, extra))
  }
  function cleanup() { run('cancel'); timers.forEach(clearTimeout) }
  return { run, video, key, document, handlers, elements, cleanup }
}
test('fullscreen waits for a trusted native key and resolves after the request completes', async () => {
  const b = browser()
  try {
    const video = b.video()
    assert.equal(b.run().pending, true)
    b.key('keydown', { isTrusted: false })
    assert.equal(b.document.fullscreenElement, undefined)
    b.key('keydown', { key: 'Enter' })
    assert.equal(b.document.fullscreenElement, undefined)
    b.key('keydown')
    b.key('keyup')
    assert.equal(b.run('poll').pending, true)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(b.run('poll'), { fullscreen: true })
    assert.equal(b.document.fullscreenElement, video)
    assert.equal(b.handlers.size, 0)
  } finally { b.cleanup() }
})
test('missing, hidden and unsupported videos produce explicit errors', () => {
  const b = browser()
  try {
    assert.equal(b.run().error, 'no_media')
    const video = b.video({ getBoundingClientRect: () => ({ width: 0, height: 0 }) })
    assert.equal(b.run().error, 'no_media')
    video.getBoundingClientRect = () => ({ width: 800, height: 450, bottom: 450, right: 800, top: 0, left: 0 })
    video.requestFullscreen = null
    assert.equal(b.run().error, 'fullscreen_unsupported')
  } finally { b.cleanup() }
})
test('visible playing video wins; shadow roots and same-origin frames are searched', async () => {
  for (const embedded of [false, 'frame', 'shadow']) {
    const b = browser()
    try {
      b.video({ paused: true })
      const active = b.video()
      if (embedded) {
        const query = b.document.querySelectorAll
        b.document.querySelectorAll = selector => selector === 'video' ? query(selector).filter(v => v !== active) : query(selector)
        const root = { querySelectorAll: selector => selector === 'video' ? [active] : [] }
        b.elements.push(embedded === 'frame' ? { tagName: 'IFRAME', contentDocument: root } : { shadowRoot: root })
        b.elements.push({ tagName: 'IFRAME', get contentDocument() { throw Error('cross-origin') } })
      }
      b.run(); b.key('keydown'); await new Promise(resolve => setImmediate(resolve))
      assert.equal(b.document.fullscreenElement, active)
    } finally { b.cleanup() }
  }
})
test('navigation, changed sources, cancellation and expired commands never enter fullscreen', async () => {
  for (const change of [v => { v.isConnected = false }, v => { v.currentSrc = 'new' }, null]) {
    const b = browser()
    try {
      const video = b.video()
      b.run()
      if (change) change(video)
      else b.run('cancel')
      b.key('keydown'); await new Promise(resolve => setImmediate(resolve))
      assert.equal(b.document.fullscreenElement, undefined)
      assert.equal(b.run('poll').error, change ? 'media_changed' : 'not_ready')
      assert.equal(b.run('prepare', 'b', Date.now() - 1).error, 'not_ready')
    } finally { b.cleanup() }
  }
})
test('fullscreen promise rejection is reported and a late resolution cannot revive a canceled command', async () => {
  const b = browser()
  try {
    const video = b.video({ requestFullscreen() { return Promise.reject(Error('denied')) } })
    b.run(); b.key('keydown'); await new Promise(resolve => setImmediate(resolve))
    assert.equal(b.run('poll').error, 'fullscreen_failed')
    let resolve
    video.requestFullscreen = () => new Promise(done => { resolve = done })
    b.run(); b.key('keydown'); b.run('cancel')
    resolve(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(b.run('poll').error, 'not_ready')
  } finally { b.cleanup() }
})
