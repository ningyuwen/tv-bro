const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { readSession } = require('../lib/discovery')
const STORAGE_KEY = 'lime-touch-preferences-v1'
const SESSION = 'lime-session-v1'
const A = { host: '192.168.1.10', port: 8877, deviceId: '12345678-1234-1234-1234-123456789abc' }
const B = { host: '192.168.1.20', port: 8877, deviceId: '22345678-1234-1234-1234-123456789abc' }
const TOKEN = 'a'.repeat(64), NEW_TOKEN = 'b'.repeat(64)
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value))
const settle = () => new Promise(resolve => setImmediate(resolve))
const failure = code => Object.assign(new Error(code), { code })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const touch = (...points) => ({ touches: points.map(([x, y]) => ({ clientX: x, clientY: y })) })
const field = (p, name, value) => p.field({ currentTarget: { dataset: { field: name } }, detail: { value } })
const mode = (p, value) => p.inputMode({ currentTarget: { dataset: { mode: value } } })
const preference = (p, name, value) => p.touchPreference({ currentTarget: { dataset: { preference: name } }, detail: { value } })

function harness(storage = new Map()) {
  let p, now = 0, serial = 0
  const timers = new Map()
  const h = { storage, timers, calls: [], connections: [], scans: [], toasts: [], searches: 0, stops: 0, closes: 0 }
  h.discover = () => Promise.resolve([])
  h.connect = () => Promise.resolve()
  h.reply = op => {
    if (op === 'info') return { deviceId: h.endpoint.deviceId || A.deviceId }
    if (op === 'authorize' || op === 'pair') return { token: TOKEN }
    return {}
  }
  class Client {
    constructor(wx, onDisconnect, onUiState) { this.onDisconnect = onDisconnect; this.onUiState = onUiState; this.token = ''; h.client = this }
    connect(endpoint, timeout) {
      this.token = ''
      h.endpoint = endpoint
      h.connections.push({ endpoint: copy(endpoint), timeout })
      return h.connect(endpoint, timeout)
    }
    request(op, fields = {}, timeout) {
      const call = { op, fields: copy(fields), timeout, token: this.token }
      h.calls.push(call)
      return Promise.resolve().then(() => h.reply(op, fields, call))
    }
    pair() { throw new Error('Pairing must not assign a token outside the page epoch guard') }
    canRequest() { return true }
    close(reason) { h.closes++; this.token = ''; if (reason) this.onDisconnect(reason.message) }
  }
  class Discovery {
    start() { h.searches++; return h.discover() }
    stop() { h.stops++ }
  }
  h.wx = {
    getStorageSync: key => copy(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, copy(value)),
    removeStorageSync: key => storage.delete(key),
    showToast: value => h.toasts.push(value.title),
    scanCode: value => h.scans.push(value)
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/remote/remote.js'), 'utf8'), {
    require(path) {
      if (path === '../../lib/remote') return { ...require('../lib/remote'), RemoteClient: Client }
      if (path === '../../lib/discovery') return { Discovery, readSession }
      return require(path.replace('../../lib/', '../lib/'))
    },
    Page: value => { p = value }, wx: h.wx, Date,
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay, delay }); return id },
    clearTimeout(id) { timers.delete(id) }
  })
  p.setData = patch => {
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.split('.'), last = parts.pop()
      parts.reduce((object, key) => object[key], p.data)[last] = value
    }
  }
  p.onLoad()
  p.visible = true
  h.p = p
  h.retryDelay = () => timers.get(p.retry)?.delay
  h.tick = async ms => {
    const end = now + ms
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      timers.delete(due[0])
      due[1].fn()
      await settle()
    }
    now = end
    await settle()
  }
  return h
}

test('foreground discovery retries at 3/6/12/15 seconds and a successful connection resets the backoff', async () => {
  const h = harness(), p = h.p
  await p.find(true)
  for (const delay of [3000, 6000, 12000, 15000, 15000]) {
    assert.equal(h.retryDelay(), delay)
    const before = h.searches
    await h.tick(delay - 1)
    assert.equal(h.searches, before)
    await h.tick(1)
    assert.equal(h.searches, before + 1)
  }
  await p.choose(A)
  assert.equal(p.data.connected, true)
  assert.equal(p.retryAttempt, 0)
  assert.equal(h.retryDelay(), undefined)
  h.client.close(new Error('连接断开'))
  assert.equal(h.retryDelay(), 3000)
})

test('remembered authorization follows a device to its new LAN address without another approval', async () => {
  const h = harness(new Map([[SESSION, { ...A, token: TOKEN }]]))
  const moved = { ...A, host: '192.168.1.99' }
  h.connect = endpoint => endpoint.host === A.host ? Promise.reject(Error('旧地址离线')) : Promise.resolve()
  h.discover = () => Promise.resolve([B, moved])
  await h.p.find(true)
  assert.equal(h.p.data.connected, true)
  assert.deepEqual(h.connections.map(call => call.endpoint.host), [A.host, moved.host])
  assert.equal(h.calls.some(call => call.op === 'authorize'), false)
  assert.equal(h.calls.find(call => call.op === 'status').token, TOKEN)
  assert.equal(h.storage.get(SESSION).host, moved.host)
})

for (const code of ['approval_denied', 'request_timeout']) {
  test(`automatic ${code} is not replayed; explicit selection can authorize again`, async () => {
    const h = harness(), p = h.p
    let denied = true
    const normal = h.reply
    h.reply = op => op === 'authorize' && denied ? Promise.reject(failure(code)) : normal(op)
    h.discover = () => Promise.resolve([A])
    await p.find(true)
    assert.equal(h.calls.filter(call => call.op === 'authorize').length, 1)
    await h.tick(3000)
    await h.tick(6000)
    assert.equal(h.calls.filter(call => call.op === 'authorize').length, 1)
    assert.equal(h.connections.length, 1)
    assert.equal(p.data.connected, false)
    assert.match(p.data.status, /点选电视重新授权/)
    assert.deepEqual(h.toasts, [])
    denied = false
    await p.choose({ currentTarget: { dataset: { index: 0 } } })
    assert.equal(h.calls.filter(call => call.op === 'authorize').length, 2)
    assert.equal(p.data.connected, true)
  })
}

test('an expired remembered token is discarded but automatic retries do not repeat a declined approval', async () => {
  const h = harness(new Map([[SESSION, { ...A, token: TOKEN }]]))
  const normal = h.reply
  h.reply = op => op === 'status' ? Promise.reject(failure('unauthorized')) : op === 'authorize' ? Promise.reject(failure('approval_denied')) : normal(op)
  h.discover = () => Promise.resolve([A])
  await h.p.find(true)
  assert.equal(h.storage.has(SESSION), false)
  assert.equal(h.calls.filter(call => call.op === 'authorize').length, 1)
  await h.tick(3000)
  assert.equal(h.calls.filter(call => call.op === 'authorize').length, 1)
})

for (const action of ['onHide', 'onUnload', 'disconnect']) {
  test(`${action} cancels retries and ignores discovery results that arrive later`, async () => {
    const h = harness(), p = h.p
    await p.find(true)
    p[action]()
    await h.tick(60000)
    assert.equal(h.searches, 1)
    assert.equal(h.timers.size, 0)
    p.visible = true
    p.autoFind = true
    const scan = deferred()
    h.discover = () => scan.promise
    const pending = p.find(true)
    p[action]()
    const snapshot = copy(p.data)
    scan.resolve([A])
    await pending
    assert.deepEqual(copy(p.data), snapshot)
    assert.equal(h.connections.length, 0)
    assert.equal(h.timers.size, 0)
  })
}

test('manual connection cancels a pending discovery retry and a failure resumes automatic discovery', async () => {
  const h = harness(), p = h.p
  await p.find(true)
  const gate = deferred()
  h.connect = () => gate.promise
  field(p, 'host', A.host)
  const pending = p.connect()
  assert.equal(h.retryDelay(), undefined)
  await h.tick(10000)
  assert.equal(h.searches, 1)
  gate.reject(Error('连接失败'))
  await pending
  assert.equal(p.data.busy, false)
  assert.equal(p.data.connectionAction, '')
  assert.ok(h.retryDelay() >= 3000)
  await h.tick(h.retryDelay())
  assert.equal(h.searches, 2)
})

test('scanner cancels retries; cancellation resumes discovery without an error toast', async () => {
  const h = harness(), p = h.p
  await p.find(true)
  p.scan()
  assert.equal(h.retryDelay(), undefined)
  await h.tick(30000)
  assert.equal(h.searches, 1)
  h.scans[0].fail({ errMsg: 'scanCode:fail cancel' })
  h.scans[0].complete()
  assert.equal(p.scanning, false)
  assert.deepEqual(h.toasts, [])
  await h.tick(h.retryDelay())
  assert.equal(h.searches, 2)
})

test('a scanner callback from an old lifecycle cannot change or reconnect a newer session', async () => {
  const h = harness(), p = h.p
  p.scan()
  const old = h.scans[0]
  p.onHide()
  p.visible = true
  await p.choose(B)
  const snapshot = copy(p.data), stored = copy(h.storage.get(SESSION)), epoch = p.epoch
  old.success({ result: JSON.stringify({ v: 1, ...A, code: '123456' }) })
  old.fail({ errMsg: 'scanCode:fail' })
  old.complete()
  await settle()
  assert.equal(h.connections.length, 1)
  assert.equal(p.epoch, epoch)
  assert.deepEqual(copy(p.data), snapshot)
  assert.deepEqual(h.storage.get(SESSION), stored)
  assert.deepEqual(h.toasts, [])
})

test('explicit selection interrupts an active discovery and its late reply cannot overwrite the chosen device', async () => {
  const h = harness(), p = h.p, discovery = deferred()
  p.setData({ devices: [A, B] })
  h.discover = () => discovery.promise
  const finding = p.find(true)
  assert.equal(p.data.connectionAction, 'find')
  await p.choose({ currentTarget: { dataset: { index: 1 } } })
  assert.ok(h.stops > 0)
  assert.ok(h.closes > 0)
  assert.equal(p.data.connected, true)
  assert.equal(h.storage.get(SESSION).deviceId, B.deviceId)
  discovery.resolve([A])
  await finding
  assert.equal(h.connections.length, 1)
  assert.equal(h.storage.get(SESSION).deviceId, B.deviceId)
  assert.deepEqual(copy(p.data.devices), [])
})

for (const stage of ['connect', 'info', 'authorize', 'pair', 'saved-status', 'approved-status']) {
  test(`late ${stage} completion cannot alter the token, capabilities or authorization of a newer epoch`, async () => {
    const h = harness(), p = h.p, gate = deferred()
    p.epoch = 1
    const normal = h.reply
    h.connect = () => stage === 'connect' ? gate.promise : Promise.resolve()
    h.reply = op => {
      if (op === stage || (op === 'status' && ['saved-status', 'approved-status'].includes(stage))) return gate.promise
      return normal(op)
    }
    const saved = stage === 'saved-status' ? { ...A, token: TOKEN } : null
    const pending = p.attach(A, saved, 1, 6000, stage === 'pair' ? '123456' : null)
    const rejected = assert.rejects(pending, /连接取消/)
    await settle()
    if (stage === 'approved-status') assert.equal(h.storage.get(SESSION).token, TOKEN)
    p.epoch++
    h.client.token = NEW_TOKEN
    p.mediaSupported = p.fullscreenSupported = p.volumeSupported = p.qualitySupported = true
    p.setData({ navigationSupported: true, connected: true, status: '新的连接' })
    const nextSession = { ...B, token: NEW_TOKEN }
    h.storage.set(SESSION, nextSession)
    if (stage === 'saved-status') gate.reject(failure('unauthorized'))
    else gate.resolve(stage === 'info' ? { deviceId: A.deviceId } : { token: TOKEN })
    await rejected
    assert.equal(h.client.token, NEW_TOKEN)
    assert.equal(p.mediaSupported, true)
    assert.equal(p.fullscreenSupported, true)
    assert.equal(p.volumeSupported, true)
    assert.equal(p.qualitySupported, true)
    assert.equal(p.data.navigationSupported, true)
    assert.equal(p.data.status, '新的连接')
    assert.deepEqual(h.storage.get(SESSION), nextSession)
    if (stage === 'connect') assert.equal(h.calls.length, 0)
  })
}

test('successful authorization is saved before a failing status and reused on the next attempt', async () => {
  const h = harness(), normal = h.reply
  h.reply = op => op === 'status' ? Promise.reject(Error('status failure')) : normal(op)
  await assert.rejects(h.p.attach(A, null, 0), /status failure/)
  assert.equal(h.storage.get(SESSION).token, TOKEN)
  h.reply = normal
  await h.p.find(true)
  assert.equal(h.p.data.connected, true)
  assert.equal(h.calls.filter(call => call.op === 'authorize').length, 1)
})

test('input modes preserve separate drafts, serialize send and report successful open and text requests', async () => {
  const h = harness(), p = h.p, gate = deferred()
  p.data.connected = true
  h.reply = () => gate.promise
  field(p, 'openText', '猫的视频')
  const sending = p.send()
  await p.send()
  mode(p, 'text')
  await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].op, 'open')
  assert.equal(h.calls[0].fields.text, '猫的视频')
  assert.equal(p.data.inputMode, 'open')
  assert.equal(p.data.inputBusy, true)
  gate.resolve({})
  await sending
  assert.match(p.data.inputStatus, /电视正在打开/)
  assert.equal(p.data.inputBusy, false)
  mode(p, 'text')
  field(p, 'pageText', '你好电视')
  h.reply = () => ({})
  await p.send()
  assert.equal(h.calls.at(-1).op, 'text')
  assert.equal(h.calls.at(-1).fields.text, '你好电视')
  assert.match(p.data.inputStatus, /电视输入框/)
  assert.equal(p.data.openText, '猫的视频')
  p.clearInput()
  assert.equal(p.data.pageText, '')
  assert.equal(p.data.openText, '猫的视频')
})

test('disconnected and empty input send nothing; no_input supplies actionable feedback', async () => {
  const h = harness(), p = h.p
  field(p, 'openText', 'example.com')
  await p.send()
  assert.match(p.data.inputStatus, /先连接电视/)
  p.data.connected = true
  field(p, 'openText', '  ')
  await p.send()
  assert.equal(h.calls.length, 0)
  mode(p, 'text')
  field(p, 'pageText', 'hello')
  h.reply = () => Promise.reject(failure('no_input'))
  await p.send()
  assert.match(p.data.inputStatus, /未选中输入框.*再点发送/)
  assert.equal(h.toasts.length, 1)
  assert.equal(p.data.inputBusy, false)
})

for (const failed of [false, true]) {
  test(`editing a draft isolates a late ${failed ? 'failed' : 'successful'} response`, async () => {
    const h = harness(), p = h.p, gate = deferred()
    p.data.connected = true
    h.reply = () => gate.promise
    field(p, 'openText', 'old')
    const sending = p.send()
    await settle()
    field(p, 'openText', 'new')
    if (failed) gate.reject(failure('no_input'))
    else gate.resolve({})
    await sending
    assert.equal(p.data.openText, 'new')
    assert.equal(p.data.inputStatus, '')
    assert.equal(p.data.inputBusy, false)
    assert.deepEqual(h.toasts, [])
  })
}

test('a late input response cannot clear the pending indicator or message of a new connection', async () => {
  const h = harness(), p = h.p, gate = deferred()
  p.data.connected = true
  h.reply = () => gate.promise
  field(p, 'openText', 'old')
  const sending = p.send()
  await settle()
  p.disconnect()
  p.epoch++
  p.setData({ connected: true, inputBusy: true, inputStatus: '新的请求正在发送' })
  gate.resolve({})
  await sending
  assert.equal(p.data.inputBusy, true)
  assert.equal(p.data.inputStatus, '新的请求正在发送')
})

test('onLoad reads saved touch preferences and actual pointer/scroll commands honor speed and reversal', async () => {
  const h = harness(new Map([[STORAGE_KEY, { pointerSpeed: 50, scrollSpeed: 200, reverseScroll: true }]])), p = h.p
  p.data.connected = true
  assert.deepEqual(copy(p.data.preferences), { pointerSpeed: 50, scrollSpeed: 200, reverseScroll: true })
  p.touchStart(touch([0, 0]))
  p.touchMove(touch([10, 4]))
  p.flushMotion()
  await settle()
  assert.equal(h.calls[0].op, 'move')
  assert.deepEqual(h.calls[0].fields, { dx: 10, dy: 4 })
  p.touchStart(touch([0, 0], [20, 0]))
  p.touchMove(touch([0, 10], [20, 10]))
  p.flushMotion()
  await settle()
  assert.equal(h.calls[1].op, 'scroll')
  assert.equal(h.calls[1].fields.dx, 0)
  assert.equal(h.calls[1].fields.dy, 40)
})

test('menu focus navigation keeps default motion even when webpage speed and reversal are customized', async () => {
  const h = harness(new Map([[STORAGE_KEY, { pointerSpeed: 50, scrollSpeed: 200, reverseScroll: true }]])), p = h.p
  p.data.connected = true
  p.updateUi({ mode: 'navigation', focus: '设置' })
  p.touchStart(touch([0, 0]))
  p.touchMove(touch([10, 4]))
  p.flushMotion()
  await settle()
  assert.deepEqual(h.calls[0].fields, { dx: 20, dy: 8 })
  p.touchStart(touch([0, 0], [20, 0]))
  p.touchMove(touch([0, 10], [20, 10]))
  p.flushMotion()
  await settle()
  assert.equal(h.calls[1].fields.dy, -20)
})

test('touch settings persist valid limits; invalid speeds fall back and restore default cancels queued motion', () => {
  const h = harness(), p = h.p
  preference(p, 'pointerSpeed', 50)
  preference(p, 'scrollSpeed', 200)
  preference(p, 'reverseScroll', true)
  assert.deepEqual(h.storage.get(STORAGE_KEY), { pointerSpeed: 50, scrollSpeed: 200, reverseScroll: true })
  for (const invalid of [49, 201, '200', NaN]) {
    preference(p, 'pointerSpeed', invalid)
    assert.equal(p.data.preferences.pointerSpeed, 100)
  }
  p.data.connected = true
  p.touchStart(touch([0, 0]))
  p.touchMove(touch([20, 10]))
  p.resetTouchSettings()
  p.flushMotion()
  assert.equal(h.calls.length, 0)
  assert.deepEqual(h.storage.get(STORAGE_KEY), { pointerSpeed: 100, scrollSpeed: 100, reverseScroll: false })
  const reopened = harness(h.storage)
  assert.deepEqual(copy(reopened.p.data.preferences), { pointerSpeed: 100, scrollSpeed: 100, reverseScroll: false })
})

test('automatic approval limits are per device and survive hide/show of the same page', async () => {
  const h = harness(), p = h.p, normal = h.reply
  h.reply = op => op === 'authorize' ? Promise.reject(failure('approval_denied')) : normal(op)
  h.discover = () => Promise.resolve([A])
  await p.find(true)
  p.onHide()
  p.onShow()
  await settle()
  assert.equal(h.calls.filter(call => call.op === 'authorize').length, 1)
  h.discover = () => Promise.resolve([B])
  await h.tick(h.retryDelay())
  assert.equal(h.calls.filter(call => call.op === 'authorize').length, 2)
  await h.tick(h.retryDelay())
  assert.equal(h.calls.filter(call => call.op === 'authorize').length, 2)
})

test('explicit device taps cannot interrupt an authorization already in progress', async () => {
  const h = harness(), p = h.p, gate = deferred(), normal = h.reply
  p.setData({ devices: [A, B] })
  h.reply = op => op === 'authorize' ? gate.promise : normal(op)
  const choosing = p.choose(A)
  await settle()
  assert.equal(p.data.connectionAction, 'device')
  await p.choose({ currentTarget: { dataset: { index: 1 } } })
  await p.connect()
  p.scan()
  assert.equal(h.connections.length, 1)
  assert.equal(h.scans.length, 0)
  gate.resolve({ token: TOKEN })
  await choosing
  assert.equal(h.storage.get(SESSION).deviceId, A.deviceId)
})

test('successful QR scanning pairs once and its complete callback does not restart discovery', async () => {
  const h = harness(), p = h.p
  await p.find(true)
  p.scan()
  const scanner = h.scans[0]
  scanner.success({ result: JSON.stringify({ v: 1, ...A, code: '123456' }) })
  scanner.complete()
  await settle()
  assert.equal(p.data.connected, true)
  assert.equal(h.calls.filter(call => call.op === 'pair').length, 1)
  assert.equal(h.calls.find(call => call.op === 'pair').fields.code, '123456')
  assert.equal(h.calls.some(call => call.op === 'authorize'), false)
  assert.equal(h.retryDelay(), undefined)
  assert.equal(h.storage.get(SESSION).token, TOKEN)
})
