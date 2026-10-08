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
