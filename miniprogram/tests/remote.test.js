const test = require('node:test')
const assert = require('node:assert/strict')
const { RemoteClient, parsePairing } = require('../lib/remote')
class FakeSocket {
  onConnect(fn) { this.connected = fn } onMessage(fn) { this.message = fn }
  onError(fn) { this.error = fn } onClose(fn) { this.closed = fn }
  connect(value) { this.endpoint = value; queueMicrotask(() => this.connected()) }
  write(data) { this.last = JSON.parse(data) }
  close() { if (this.closed) this.closed() }
}
async function client() {
  const socket = new FakeSocket()
  const remote = new RemoteClient({ createTCPSocket: () => socket })
  await remote.connect({ host: '192.168.2.130', port: 8877 })
  return { socket, remote }
}
function deliver(socket, text) { socket.message({ message: Buffer.from(text) }) }
test('pairing QR accepts private networks and rejects public, invalid and legacy payloads', () => {
  assert.equal(parsePairing('{"v":1,"host":"192.168.2.130","port":8877,"code":"012345"}').code, '012345')
  for (const host of ['8.8.8.8', '127.0.0.1', '192.168.2.999', 'localhost']) {
    assert.throws(() => parsePairing(JSON.stringify({ v: 1, host, port: 8877, code: '123456' })))
  }
  assert.throws(() => parsePairing('not a QR'))
  assert.throws(() => parsePairing('{"v":2,"host":"10.0.0.1","port":8877,"code":"123456"}'))
})
test('split UTF-8 and coalesced responses resolve the right commands', async () => {
  const { socket, remote } = await client()
  const one = remote.request('status'), id1 = socket.last.id
  const two = remote.request('status'), id2 = socket.last.id
  const bytes = Buffer.from(JSON.stringify({ id: id2, ok: true, name: '青柠' }) + '\n' + JSON.stringify({ id: id1, ok: true }) + '\n')
  const split = bytes.indexOf(Buffer.from('青')) + 1
  socket.message({ message: bytes.subarray(0, split) })
  socket.message({ message: bytes.subarray(split) })
  assert.equal((await two).name, '青柠')
  assert.equal((await one).id, id1)
  remote.close()
})
test('successful pairing attaches token to commands', async () => {
  const { socket, remote } = await client()
  const pair = remote.pair('012345')
  deliver(socket, JSON.stringify({ id: socket.last.id, ok: true, token: 'a'.repeat(64) }) + '\n')
  await pair
  const command = remote.request('move', { dx: 2, dy: 3 })
  assert.equal(socket.last.token, 'a'.repeat(64))
  deliver(socket, JSON.stringify({ id: socket.last.id, ok: true }) + '\n')
  await command
  remote.close()
})
test('close rejects pending commands and clears credentials without replay', async () => {
  const { remote } = await client()
  const pending = remote.request('click')
  remote.close()
  await assert.rejects(pending, /连接已关闭/)
  assert.equal(remote.pending.size, 0)
  assert.equal(remote.token, '')
})
test('invalid pairing and auth responses produce user-visible errors', async () => {
  const { socket, remote } = await client()
  const pending = remote.pair('012345')
  deliver(socket, JSON.stringify({ id: socket.last.id, ok: false, error: 'pair_failed' }) + '\n')
  await assert.rejects(pending, /配对失败/)
  remote.close()
})
test('oversized frame disconnects and cancels pending operations', async () => {
  const { socket, remote } = await client()
  const pending = remote.request('status')
  deliver(socket, 'a'.repeat(16385))
  await assert.rejects(pending, /无效数据/)
  assert.equal(remote.socket, null)
})
test('unknown response IDs do not acknowledge another command', async () => {
  const { socket, remote } = await client()
  const pending = remote.request('click')
  deliver(socket, '{"id":999,"ok":true}\n')
  assert.equal(remote.pending.size, 1)
  deliver(socket, JSON.stringify({ id: socket.last.id, ok: true }) + '\n')
  await pending
  remote.close()
})
