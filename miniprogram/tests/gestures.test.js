const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function page() {
  let definition
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/remote/remote.js'), 'utf8'), {
    require: path => path.endsWith('/media') ? require('../lib/media') : path.endsWith('/volume') ? require('../lib/volume') : ({}), Page: value => { definition = value },
    setTimeout, clearTimeout, setInterval, clearInterval, Date
  })
  const calls = []
  definition.data = { connected: true }
  definition.client = { request: (op, fields) => { calls.push({ op, fields }); return Promise.resolve() }, close() {} }
  definition.setData = data => Object.assign(definition.data, data)
  return { page: definition, calls }
}
const touches = (...points) => ({ touches: points.map(([x, y]) => ({ clientX: x, clientY: y })) })
test('quick single finger tap clicks once', () => {
  const state = page()
  state.page.touchStart(touches([30, 30]))
  state.page.touchEnd(touches())
  assert.deepEqual(state.calls.map(c => c.op), ['click'])
})
test('motion aggregates and never clicks after dragging', () => {
  const state = page()
  state.page.touchStart(touches([20, 20]))
  state.page.touchMove(touches([30, 24]))
  state.page.touchMove(touches([40, 28]))
  state.page.touchEnd(touches())
  assert.deepEqual(state.calls.map(c => c.op), ['move'])
  assert.equal(state.calls[0].fields.dx, 40)
  assert.equal(state.calls[0].fields.dy, 16)
})
test('lifting one finger after scrolling never emits a click or pointer jump', () => {
  const state = page()
  state.page.touchStart(touches([20, 20], [40, 20]))
  state.page.touchMove(touches([20, 40], [40, 40]))
  state.page.touchEnd(touches([20, 40]))
  state.page.touchEnd(touches())
  assert.deepEqual(state.calls.map(c => c.op), ['scroll'])
  assert.equal(state.calls[0].fields.dy, -40)
})
test('gesture cancellation discards queued motion', () => {
  const state = page()
  state.page.touchStart(touches([20, 20]))
  state.page.touchMove(touches([100, 100]))
  state.page.touchCancel()
  state.page.flushMotion()
  assert.equal(state.calls.length, 0)
})
test('TV navigation mode cancels an old webpage drag and shows the current selection', () => {
  const state = page()
  state.page.touchStart(touches([20, 20]))
  state.page.touchMove(touches([100, 100]))
  state.page.updateUi({ mode: 'navigation', focus: '收藏夹' })
  state.page.touchEnd(touches())
  assert.equal(state.calls.length, 0)
  assert.equal(state.page.data.navigation, true)
  assert.equal(state.page.data.focusedControl, '收藏夹')
  state.page.updateUi({ mode: 'pointer', focus: '' })
  assert.equal(state.page.data.navigation, false)
})
test('menu gestures still use server routing and a tap confirms through click', () => {
  const state = page()
  state.page.updateUi({ mode: 'navigation', focus: '设置' })
  state.page.touchStart(touches([20, 20]))
  state.page.touchMove(touches([70, 20]))
  state.page.touchEnd(touches())
  state.page.touchStart(touches([30, 30]))
  state.page.touchEnd(touches())
  assert.deepEqual(state.calls.map(c => c.op), ['move', 'click'])
})
test('direction buttons discard pending touch motion before sending a key', async () => {
  const state = page()
  state.page.touchStart(touches([20, 20]))
  state.page.touchMove(touches([100, 100]))
  await state.page.command({ currentTarget: { dataset: { op: 'right' } } })
  state.page.flushMotion()
  assert.deepEqual(state.calls.map(c => c.op), ['right'])
  state.page.toggleDirections()
  assert.equal(state.page.data.showDirections, true)
  state.page.toggleDirections()
  assert.equal(state.page.data.showDirections, false)
})
