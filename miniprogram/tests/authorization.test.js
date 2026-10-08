const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const device = { host: '192.168.2.103', port: 8877, deviceId: '12345678-1234-1234-1234-123456789abc' }
const token = 'a'.repeat(64)

function page(saved, failStatus = false) {
  let p, stored = saved
  const requests = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/remote/remote.js'), 'utf8'), {
    require: path => require(path.replace('../../lib/', '../lib/')),
    Page: value => { p = value },
    wx: { setStorageSync: (_, value) => { stored = value }, removeStorageSync: () => { stored = null } },
    setTimeout: () => 1, clearTimeout
  })
  p.visible = true
  p.epoch = 1
  p.setData = values => Object.assign(p.data, values)
  p.startMediaPolling = () => {}
  p.startVolumePolling = () => {}
  p.client = {
    connect: async () => {},
    request: async op => {
      requests.push({ op, token: p.client.token })
      if (op === 'info') return { deviceId: device.deviceId }
      if (op === 'authorize') return { token }
      if (op === 'status' && failStatus) throw new Error('连接已断开')
      return {}
    }
  }
  return { p, requests, stored: () => stored }
}

test('reopening the remote reuses saved approval without asking the TV', async () => {
  const saved = { ...device, token }
  const { p, requests } = page(saved)
  await p.attach(device, saved, 1)
  assert.equal(p.data.connected, true)
  assert.deepEqual(requests.map(request => request.op), ['info', 'status'])
  assert.equal(requests[1].token, token)
})

test('successful approval is remembered even if the following status request disconnects', async () => {
  const first = page(null, true)
  await assert.rejects(first.p.attach(device, null, 1), /连接已断开/)
  assert.equal(first.stored().token, token)
  const next = page(first.stored())
  await next.p.attach(device, first.stored(), 1)
  assert.equal(next.requests.some(request => request.op === 'authorize'), false)
  assert.equal(next.p.data.connected, true)
})
