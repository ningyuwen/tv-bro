const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
test('Gecko content bridge accepts scrolls only in its top-level frame', () => {
  const source = fs.readFileSync(require.resolve('../../app/gecko/src/main/assets/extensions/generic/content.js'), 'utf8')
  for (const top of [true, false]) {
    const calls = []
    let receive
    const window = { addEventListener() {} }
    window.top = top ? window : {}
    vm.runInNewContext(source, { window, console: { log() {} },
      browser: { runtime: { connectNative: () => ({ onMessage: { addListener(fn) { receive = fn } } }) } },
      limeRemoteScroll: (...args) => calls.push(args) })
    receive({ action: 'unrelated' })
    receive({ action: 'remoteScroll', x: 100, y: 120, dx: 0, dy: 20, gestureId: 'g-1', deadline: 10000 })
    assert.deepEqual(calls, top ? [[100, 120, 0, 20, 'g-1', 10000]] : [])
  }
})
