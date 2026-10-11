const test = require('node:test')
const assert = require('node:assert/strict')
const { authorizationHarness } = require('./helpers/authorization')

// Synthetic identities/credentials: no real TV, phone storage or network access.
const oldDevice = { host: '192.168.2.103', port: 8877, deviceId: '11111111-1111-4111-8111-111111111111' }
const newDevice = { ...oldDevice, deviceId: '22222222-2222-4222-8222-222222222222' }
const oldToken = 'a'.repeat(64), newToken = 'b'.repeat(64)
const oldSession = { ...oldDevice, token: oldToken }
const session = (device, token = newToken) => ({ ...device, token })
const operations = h => h.requests.map(request => request.op)

async function startChoice(h, device = newDevice) {
  const pending = h.page.choose(device)
  await h.flush()
  await h.info(device)
  return { pending }
}

test('package replacement at the saved IP discovers a new identity, approves once and reconnects with the new token', async t => {
  const h = authorizationHarness(t, { saved: oldSession, devices: [newDevice] })
  const pending = h.page.find()
  await h.flush()
  await h.info(newDevice) // Old IP now belongs to the new package; stop at info.
  assert.deepEqual(operations(h), ['info'])
  assert.equal(h.sockets[0].closed, true)
  assert.deepEqual(h.stored(), oldSession)
  await h.tick(4000)
  assert.ok(h.probes.length > 0)
  for (const probe of h.probes) {
    assert.equal(probe.address, '255.255.255.255')
    assert.equal(probe.port, 8878)
    assert.equal(probe.setBroadcast, true)
    assert.deepEqual(Object.keys(probe.message).sort(), ['nonce', 'type', 'v'])
  }
  assert.equal(h.udpSockets[0].closed, true)
  await h.info(newDevice)
  assert.deepEqual(operations(h), ['info', 'info', 'authorize'])
  assert.equal(h.page.data.connected, false)
  assert.match(h.page.data.status, /允许并记住/)
  assert.deepEqual(h.stored(), oldSession, 'do not replace storage before approval')
  await h.approve(newToken)
  await pending
  assert.equal(h.page.data.connected, true)
  assert.deepEqual(h.stored(), session(newDevice))
  assert.ok(h.requests.every(request => request.token !== oldToken))

  h.page.onHide()
  assert.deepEqual(h.stored(), session(newDevice))
  h.page.onShow()
  await h.flush()
  await h.info(newDevice)
  assert.equal(h.last('status').token, newToken)
  h.reply()
  await h.flush()
  assert.equal(h.page.data.connected, true)
  assert.equal(h.requests.filter(request => request.op === 'authorize').length, 1)
  const command = h.page.command({ currentTarget: { dataset: { op: 'home' } } })
  assert.equal(h.last('home').token, newToken)
  h.reply()
  await command
})

for (const sameIdentity of [false, true]) {
  test('discovery after an unreachable saved address ' + (sameIdentity ? 'reuses approval only for the same identity' : 'requires approval for a replacement'), async t => {
    const device = { ...(sameIdentity ? oldDevice : newDevice), host: '192.168.2.104', port: 8879 }
    const h = authorizationHarness(t, { saved: oldSession, devices: [device], offline: [oldDevice.host] })
    const pending = h.page.find()
    await h.flush()
    await h.tick(4000)
    assert.equal(h.sockets.at(-1).endpoint.address, device.host)
    assert.equal(h.sockets.at(-1).endpoint.port, device.port)
    await h.info(device)
    if (sameIdentity) {
      assert.equal(h.last('status').token, oldToken)
      h.reply()
    } else await h.approve(newToken)
    await pending
    assert.equal(h.page.data.connected, true)
    assert.deepEqual(h.stored(), session(device, sameIdentity ? oldToken : newToken))
    assert.deepEqual(operations(h), sameIdentity ? ['info', 'status'] : ['info', 'authorize', 'status'])
  })
}

test('multiple replacement devices wait for selection and do not inherit the old approval', async t => {
  const other = { ...newDevice, host: '192.168.2.105', deviceId: '33333333-3333-4333-8333-333333333333' }
  const h = authorizationHarness(t, { saved: oldSession, devices: [newDevice, other], offline: [oldDevice.host] })
  const finding = h.page.find()
  await h.flush()
  await h.tick(4000)
  await finding
  assert.equal(h.page.data.devices.length, 2)
  assert.equal(h.page.data.busy, false)
  assert.deepEqual(operations(h), [])
  const selected = h.page.choose({ currentTarget: { dataset: { index: 1 } } })
  await h.flush()
  await h.info(other)
  await h.approve(newToken)
  await selected
  assert.deepEqual(h.stored(), session(other))
})

test('multiple discoveries prefer the remembered identity even when a replacement replies first', async t => {
  const remembered = { ...oldDevice, host: '192.168.2.106' }
  const h = authorizationHarness(t, { saved: oldSession, devices: [newDevice, remembered], offline: [oldDevice.host] })
  const pending = h.page.find()
  await h.flush()
  await h.tick(4000)
  assert.equal(h.sockets.at(-1).endpoint.address, remembered.host)
  await h.info(remembered)
  assert.equal(h.last('status').token, oldToken)
  h.reply()
  await pending
  assert.deepEqual(operations(h), ['info', 'status'])
  assert.deepEqual(h.stored(), session(remembered, oldToken))
})

for (const [name, changed] of [
  ['missing identity', { deviceId: undefined }],
  ['invalid token', { token: 'short' }],
  ['public address', { host: '8.8.8.8' }],
  ['invalid port', { port: 65536 }]
]) {
  test('invalid saved session (' + name + ') is ignored before connecting', async t => {
    const h = authorizationHarness(t, { saved: { ...oldSession, ...changed }, devices: [newDevice] })
    const pending = h.page.find()
    await h.flush()
    assert.equal(h.sockets.length, 0)
    await h.tick(4000)
    await h.info(newDevice)
    await h.approve(newToken)
    await pending
    assert.deepEqual(operations(h), ['info', 'authorize', 'status'])
    assert.deepEqual(h.stored(), session(newDevice))
  })
}

test('a discovered identity must match TCP info before any credential or approval is sent', async t => {
  const h = authorizationHarness(t, { saved: oldSession })
  const pending = h.page.choose(newDevice)
  await h.flush()
  await h.info(oldDevice)
  await pending
  assert.deepEqual(operations(h), ['info'])
  assert.equal(h.page.data.connected, false)
  assert.equal(h.page.data.busy, false)
  assert.match(h.page.data.status, /地址已变化/)
  assert.deepEqual(h.stored(), oldSession)
})

test('an expired token is removed before fresh approval and never sent with authorize', async t => {
  const h = authorizationHarness(t, { saved: oldSession })
  const { pending } = await startChoice(h, oldDevice)
  assert.equal(h.last('status').token, oldToken)
  h.reply({ ok: false, error: 'unauthorized' })
  await h.flush()
  assert.equal(h.stored(), null)
  assert.deepEqual(h.writes, [null])
  await h.approve(newToken)
  await pending
  assert.deepEqual(h.stored(), session(oldDevice))
  assert.deepEqual(operations(h), ['info', 'status', 'authorize', 'status'])
})

for (const code of ['approval_denied', 'approval_busy']) {
  test(code + ' leaves a replacement disconnected and a later explicit retry can succeed', async t => {
    const h = authorizationHarness(t, { saved: oldSession })
    const { pending } = await startChoice(h)
    assert.equal(h.last('authorize').token, '')
    h.reply({ ok: false, error: code })
    await pending
    assert.equal(h.page.data.connected, false)
    assert.equal(h.page.data.busy, false)
    assert.equal(h.sockets[0].closed, true)
    assert.equal(h.errors.length, 1)
    assert.deepEqual(h.stored(), oldSession)
    assert.deepEqual(operations(h), ['info', 'authorize'])
    const retry = await startChoice(h)
    await h.approve(newToken)
    await retry.pending
    assert.equal(h.page.data.connected, true)
    assert.ok(h.requests.every(request => request.token !== oldToken))
    assert.deepEqual(h.stored(), session(newDevice))
  })

  test(code + ' after saved-token rejection does not automatically request approval again', async t => {
    const h = authorizationHarness(t, { saved: oldSession, devices: [oldDevice] })
    const pending = h.page.find()
    await h.flush()
    await h.info(oldDevice)
    h.reply({ ok: false, error: 'unauthorized' }, h.last('status'))
    await h.flush()
    h.reply({ ok: false, error: code }, h.last('authorize'))
    await h.flush()
    assert.equal(h.probes.length, 0, 'an approval failure must not trigger another automatic attempt')
    await pending
    assert.equal(h.stored(), null)
    assert.equal(h.page.data.busy, false)
    assert.equal(h.page.data.connected, false)
    assert.equal(h.errors.length, 1)
    const retry = await startChoice(h, oldDevice)
    await h.approve(newToken)
    await retry.pending
    assert.equal(h.page.data.connected, true)
  })
}

test('approval timeout closes the attempt, ignores a late token and allows a fresh retry', async t => {
  const h = authorizationHarness(t, { saved: oldSession })
  const { pending } = await startChoice(h)
  const expired = h.last('authorize')
  await h.tick(35000)
  await pending
  assert.equal(h.page.data.connected, false)
  assert.equal(h.page.data.busy, false)
  assert.match(h.page.data.status, /超时/)
  h.reply({ token: 'c'.repeat(64) }, expired)
  await h.flush()
  assert.deepEqual(h.stored(), oldSession)
  const retry = await startChoice(h)
  await h.approve(newToken)
  await retry.pending
  assert.deepEqual(h.stored(), session(newDevice))
})

for (const failure of ['timeout', 'invalid response']) {
  test('saved-token rejection followed by approval ' + failure + ' stops automatic retries', async t => {
    const h = authorizationHarness(t, { saved: oldSession, devices: [oldDevice] })
    const pending = h.page.find()
    await h.flush()
    await h.info(oldDevice)
    h.reply({ ok: false, error: 'unauthorized' }, h.last('status'))
    await h.flush()
    assert.equal(h.last('authorize').token, '')
    if (failure === 'timeout') await h.tick(35000)
    else h.reply({ token: 'short' })
    await h.flush()
    assert.equal(h.probes.length, 0)
    await pending
    assert.equal(h.stored(), null)
    assert.equal(h.page.data.connected, false)
    assert.equal(h.page.data.busy, false)
    assert.equal(h.errors.length, 1)
    const retry = await startChoice(h, oldDevice)
    await h.approve(newToken)
    await retry.pending
    assert.deepEqual(h.stored(), session(oldDevice))
  })
}

for (const token of [undefined, 'short', 'B'.repeat(64)]) {
  test('invalid approval token ' + String(token) + ' is never saved or used for status', async t => {
    const h = authorizationHarness(t, { saved: oldSession })
    const { pending } = await startChoice(h)
    h.reply({ token }, h.last('authorize'))
    await pending
    assert.deepEqual(operations(h), ['info', 'authorize'])
    assert.deepEqual(h.stored(), oldSession)
    assert.deepEqual(h.writes, [])
    assert.equal(h.page.data.connected, false)
    assert.match(h.page.data.status, /授权响应无效/)
  })
}

test('approved replacement credentials survive a status disconnect and are used on retry', async t => {
  const h = authorizationHarness(t, { saved: oldSession })
  const { pending } = await startChoice(h)
  h.reply({ token: newToken }, h.last('authorize'))
  await h.flush()
  assert.equal(h.last('status').token, newToken)
  assert.deepEqual(h.stored(), session(newDevice))
  h.sockets.at(-1).ended()
  await pending
  assert.equal(h.page.data.connected, false)
  assert.deepEqual(h.stored(), session(newDevice))
  const retry = await startChoice(h)
  assert.equal(h.last('status').token, newToken)
  h.reply()
  await retry.pending
  assert.equal(h.page.data.connected, true)
  assert.equal(h.requests.filter(request => request.op === 'authorize').length, 1)
})

test('a transport failure during saved-token validation preserves approval for the next connection', async t => {
  const h = authorizationHarness(t, { saved: oldSession })
  const { pending } = await startChoice(h, oldDevice)
  h.last('status').socket.error()
  await pending
  assert.deepEqual(h.stored(), oldSession)
  assert.deepEqual(h.writes, [])
  assert.deepEqual(operations(h), ['info', 'status'])
  const retry = await startChoice(h, oldDevice)
  assert.equal(h.last('status').token, oldToken)
  h.reply()
  await retry.pending
  assert.equal(h.page.data.connected, true)
})

test('hiding during approval ignores the closed socket response and reconnects without old credentials', async t => {
  const h = authorizationHarness(t, { saved: oldSession })
  const { pending } = await startChoice(h)
  const abandoned = h.last('authorize')
  h.page.onHide()
  await pending
  h.reply({ token: 'c'.repeat(64) }, abandoned)
  await h.flush()
  assert.deepEqual(h.stored(), oldSession)
  assert.deepEqual(h.writes, [])
  assert.equal(h.page.data.connected, false)
  assert.equal(h.errors.length, 0)
  h.page.visible = true
  const retry = await startChoice(h)
  await h.approve(newToken)
  await retry.pending
  assert.deepEqual(h.stored(), session(newDevice))
  assert.ok(h.requests.every(request => request.token !== oldToken))
})

test('an already delivered approval cannot overwrite credentials after the page changes connection', async t => {
  const h = authorizationHarness(t, { saved: oldSession })
  const { pending } = await startChoice(h)
  // Resolve the protocol promise, then cancel before its page continuation runs.
  h.reply({ token: 'c'.repeat(64) }, h.last('authorize'))
  h.page.onHide()
  h.page.visible = true
  const retry = h.page.choose(newDevice)
  await h.flush()
  assert.deepEqual(h.stored(), oldSession)
  assert.deepEqual(h.writes, [])
  await h.info(newDevice)
  await h.approve(newToken)
  await Promise.all([pending, retry])
  assert.deepEqual(h.stored(), session(newDevice))
  assert.ok(h.requests.every(request => request.token !== 'c'.repeat(64)))
})

test('an already delivered unauthorized reply cannot remove storage or authorize on a newer connection', async t => {
  const h = authorizationHarness(t, { saved: oldSession })
  const { pending } = await startChoice(h, oldDevice)
  h.reply({ ok: false, error: 'unauthorized' }, h.last('status'))
  h.page.onHide()
  h.page.visible = true
  const retry = h.page.choose(newDevice)
  await h.flush()
  assert.deepEqual(h.stored(), oldSession)
  assert.deepEqual(h.writes, [])
  assert.deepEqual(operations(h), ['info', 'status', 'info'])
  await h.info(newDevice)
  await h.approve(newToken)
  await Promise.all([pending, retry])
  assert.equal(h.page.data.connected, true)
  assert.deepEqual(h.stored(), session(newDevice))
  assert.equal(h.errors.length, 0)
})
