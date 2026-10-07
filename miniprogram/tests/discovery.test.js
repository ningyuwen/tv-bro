const test = require('node:test')
const assert = require('node:assert/strict')
const { Discovery, parseDiscovery, readSession } = require('../lib/discovery')
const id = '12345678-1234-1234-1234-123456789abc'
function event(nonce, extra = {}) {
  const message = Buffer.from(JSON.stringify(Object.assign({ v: 1, type: 'lime-browser', deviceId: id, port: 8877, nonce }, extra)))
  return { message: message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength), remoteInfo: { address: '192.168.2.130' } }
}
test('discovery matches nonce and uses source address rather than supplied host', () => {
  assert.equal(parseDiscovery(event('a', { host: '8.8.8.8' }), 'a').host, '192.168.2.130')
  assert.throws(() => parseDiscovery(event('a'), 'b'))
  const publicPeer = event('a'); publicPeer.remoteInfo.address = '8.8.8.8'
  assert.throws(() => parseDiscovery(publicPeer, 'a'))
})
test('saved authorization validates host and credential before reconnecting', () => {
  const saved = { deviceId: id, token: 'a'.repeat(64), host: '192.168.2.130', port: 8877 }
  assert.equal(readSession({ getStorageSync: () => saved }).deviceId, id)
  assert.equal(readSession({ getStorageSync: () => ({ ...saved, token: 'short' }) }), null)
  assert.equal(readSession({ getStorageSync: () => ({ ...saved, host: '8.8.8.8' }) }), null)
})
test('UDP discovery deduplicates replies and closes its socket', async () => {
  let callback, closed = false, sent
  const socket = { onMessage(fn) { callback = fn }, onError() {}, bind() {}, close() { closed = true },
    send(value) { sent = value; const nonce = JSON.parse(value.message).nonce; callback(event(nonce)); callback(event(nonce)) } }
  const discovery = new Discovery({ createUDPSocket: () => socket })
  const devices = await discovery.start(15)
  assert.equal(devices.length, 1)
  assert.equal(devices[0].deviceId, id)
  assert.equal(sent.setBroadcast, true)
  assert.equal(closed, true)
})
test('leaving the page cancels discovery without late connection', async () => {
  const discovery = new Discovery({ createUDPSocket: () => ({ onMessage() {}, onError() {}, bind() {}, send() {}, close() {} }) })
  const pending = discovery.start()
  discovery.stop()
  assert.deepEqual(await pending, [])
})
