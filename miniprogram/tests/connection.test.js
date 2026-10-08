const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { RemoteClient } = require('../lib/remote')

const settle = () => new Promise(resolve => setImmediate(resolve))
const touches = (...points) => ({ touches: points.map(([x, y]) => ({ clientX: x, clientY: y })) })
function harness() {
  let p, time = 0, next = 0
  const timers = new Map(), calls = [], closed = [], errors = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/remote/remote.js'), 'utf8'), {
    require: path => require(path.replace('../../lib/', '../lib/')), Page: value => { p = value },
    wx: { showToast: value => errors.push(value.title) }, Date,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: time + delay }); return id },
    clearTimeout(id) { timers.delete(id) }
  })
  p.epoch = 1
  p.data.connected = true
  p.setData = value => Object.assign(p.data, value)
  p.client = { canRequest: () => true, request(op, fields) {
    return new Promise((resolve, reject) => calls.push({ op, fields, resolve, reject }))
  }, close(error) { closed.push(error); p.data.connected = false } }
  async function tick(ms) {
    const end = time + ms
    while (true) {
      const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry) break
      time = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await settle()
    }
    time = end; await settle()
  }
  return { p, calls, closed, errors, tick }
}
const failure = code => Object.assign(new Error(code), { code })

test('slow heartbeats never overlap; congestion and a responsive busy TV keep the connection', async () => {
  const { p, calls, closed, tick } = harness()
  p.startHeartbeat()
  await tick(1000)
  await tick(10000)
  assert.equal(calls.length, 1)
  for (const code of ['client_busy', 'not_ready', 'rate_limited']) {
    calls.at(-1).reject(failure(code)); await settle(); await tick(1000)
  }
  assert.equal(closed.length, 0)
  calls.at(-1).resolve({}); await settle()
  p.stopHeartbeat()
  await tick(5000)
  assert.equal(calls.length, 4)
})

test('one heartbeat timeout recovers; two consecutive timeouts close a dead connection', async () => {
  const { p, calls, closed, tick } = harness()
  p.startHeartbeat(); await tick(1000)
  calls.at(-1).reject(failure('request_timeout')); await settle(); await tick(1000)
  assert.equal(closed.length, 0)
  calls.at(-1).resolve({}); await settle(); await tick(1000)
  calls.at(-1).reject(failure('request_timeout')); await settle(); await tick(1000)
  assert.equal(closed.length, 0)
  calls.at(-1).reject(failure('request_timeout')); await settle()
  assert.equal(closed.length, 1)
  await tick(10000)
  assert.equal(calls.length, 4)
})

test('authorization loss closes immediately, but an old heartbeat cannot close a new connection', async () => {
  const { p, calls, closed, tick } = harness()
  p.startHeartbeat(); await tick(1000)
  const old = calls[0]
  p.startHeartbeat(); await tick(1000)
  old.reject(failure('unauthorized')); await settle()
  assert.equal(closed.length, 0)
  calls.at(-1).reject(failure('unauthorized')); await settle()
  assert.equal(closed.length, 1)
})

test('hundreds of movement events merge behind one in-flight command and remain bounded', async () => {
  const { p, calls, tick } = harness()
  p.touchStart(touches([0, 0]))
  p.touchMove(touches([10, 0])); await tick(32)
  for (let x = 11; x <= 500; x++) { p.touchMove(touches([x, 0])); await tick(32) }
  p.touchEnd(touches())
  assert.equal(calls.length, 1)
  calls[0].resolve({}); await settle(); await tick(32)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].fields.dx, 500)
  calls[1].resolve({}); await settle(); await tick(1000)
  assert.equal(calls.length, 2)
})

test('cancel, interface change and timeout discard unsent motion rather than replay it', async () => {
  for (const cancel of [p => p.touchCancel(), p => p.command({ currentTarget: { dataset: { op: 'menu' } } }), null]) {
    const { p, calls, tick } = harness()
    p.touchStart(touches([0, 0])); p.touchMove(touches([10, 0])); await tick(32)
    p.touchMove(touches([20, 0]))
    if (cancel) cancel(p)
    if (cancel) calls[0].resolve({})
    else calls[0].reject(failure('request_timeout'))
    await settle(); await tick(1000)
    assert.equal(calls.filter(call => call.op === 'move').length, 1)
  }
})

test('vertical and horizontal gestures lock their axis, ignore jitter, and unlock on the next gesture', async () => {
  const { p, calls, tick } = harness()
  p.touchStart(touches([0, 0], [20, 0]))
  p.touchMove(touches([2, 3], [22, 3])); await tick(32)
  assert.equal(calls.length, 0)
  p.touchMove(touches([3, 12], [23, 12])); await tick(32)
  assert.equal(calls[0].fields.dx, 0)
  assert.equal(calls[0].fields.dy, -24)
  const first = calls[0].fields.gestureId
  calls[0].resolve({}); await settle()
  p.touchMove(touches([40, 14], [60, 14])); await tick(32)
  assert.equal(calls[1].fields.dx, 0)
  assert.equal(calls[1].fields.gestureId, first)
  calls[1].resolve({}); await settle()
  p.touchEnd(touches())
  p.touchStart(touches([0, 0], [20, 0]))
  p.touchMove(touches([15, 2], [35, 2])); await tick(32)
  assert.equal(calls[2].fields.dy, 0)
  assert.equal(calls[2].fields.dx, -30)
  assert.notEqual(calls[2].fields.gestureId, first)
})

test('lifting a finger cannot turn a scroll into pointer movement or a click', async () => {
  const { p, calls, tick } = harness()
  p.touchStart(touches([0, 0], [20, 0]))
  p.touchMove(touches([0, 10], [20, 10])); await tick(32)
  calls[0].resolve({}); await settle()
  p.touchEnd(touches([0, 10]))
  p.touchMove(touches([50, 50])); await tick(32)
  p.touchEnd(touches())
  assert.deepEqual(calls.map(call => call.op), ['scroll'])
})

test('adding a third finger keeps the same axis and target identity', async () => {
  const { p, calls, tick } = harness()
  p.touchStart(touches([0, 0], [20, 0]))
  p.touchMove(touches([0, 10], [20, 10])); await tick(32)
  const id = calls[0].fields.gestureId
  calls[0].resolve({}); await settle()
  p.touchStart(touches([0, 10], [20, 10], [40, 10]))
  p.touchMove(touches([40, 12], [60, 12], [80, 12])); await tick(32)
  assert.equal(calls[1].fields.dx, 0)
  assert.equal(calls[1].fields.gestureId, id)
})

test('a new tap drops unsent old drag movement and keeps click ordering', async () => {
  const { p, calls, tick } = harness()
  p.touchStart(touches([0, 0])); p.touchMove(touches([10, 0])); await tick(32)
  p.touchMove(touches([20, 0])); p.touchEnd(touches())
  p.touchStart(touches([20, 0])); p.touchEnd(touches())
  assert.deepEqual(calls.map(call => call.op), ['move', 'click'])
  calls[0].resolve({}); await settle(); await tick(1000)
  assert.deepEqual(calls.map(call => call.op), ['move', 'click'])
})

test('an old motion rejection cannot cancel movement or show an error after reconnection', async () => {
  const { p, calls, tick, errors } = harness()
  p.touchStart(touches([0, 0])); p.touchMove(touches([10, 0])); await tick(32)
  p.epoch++; p.clearMotion()
  p.touchStart(touches([0, 0])); p.touchMove(touches([20, 0])); await tick(32)
  assert.equal(calls.length, 2)
  calls[0].reject(failure('request_timeout')); await settle()
  p.touchMove(touches([30, 0]))
  calls[1].resolve({}); await settle(); await tick(32)
  assert.equal(calls.length, 3)
  assert.deepEqual(errors, [])
})

test('optional status polling yields when the request budget is full', async () => {
  const { p, calls, tick } = harness()
  p.mediaSupported = p.volumeSupported = true
  p.client.canRequest = () => false
  p.startMediaPolling(); p.startVolumePolling(); await tick(3000)
  assert.equal(calls.length, 0)
  p.stopMediaPolling(); p.stopVolumePolling()
})

test('real request queue stays connected during delayed movement and concurrent status polling', async () => {
  const { p, tick, errors } = harness()
  let disconnected = false
  const written = []
  const socket = {
    onConnect(fn) { this.connected = fn }, onMessage(fn) { this.message = fn }, onError() {}, onClose() {},
    connect() { this.connected() }, write(raw) { written.push(JSON.parse(raw)) }, close() {}
  }
  const client = new RemoteClient({ createTCPSocket: () => socket }, () => { disconnected = true })
  await client.connect({ host: '192.168.2.103', port: 8877 })
  p.client = client
  p.mediaSupported = p.volumeSupported = true
  p.startHeartbeat(); p.startMediaPolling(); p.startVolumePolling()
  p.touchStart(touches([0, 0]))
  try {
    for (let x = 1; x <= 100; x++) { p.touchMove(touches([x, 0])); await tick(32) }
    assert.equal(written.filter(request => request.op === 'move').length, 1)
    assert.equal(written.filter(request => request.op === 'status').length, 1)
    assert.equal(client.pending.size, 4)
    assert.equal(disconnected, false)
    assert.deepEqual(errors, [])
    for (const request of written.slice()) socket.message({ message: Buffer.from(JSON.stringify({ id: request.id, ok: true }) + '\n') })
    await settle(); await tick(32)
    assert.equal(written.filter(request => request.op === 'move').length, 2)
  } finally {
    p.data.connected = false; p.stopHeartbeat(); p.stopMediaPolling(); p.stopVolumePolling(); p.clearMotion(); client.close(); await settle()
  }
})
