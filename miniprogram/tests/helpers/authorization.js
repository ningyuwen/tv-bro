const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const flush = () => new Promise(resolve => setImmediate(resolve))
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value))

// Only the wx boundary and clock are fake. Run the real page, Discovery and
// RemoteClient together, including storage validation and NDJSON serialization.
function authorizationHarness(t, { saved = null, devices = [], offline = [] } = {}) {
  let page, stored = copy(saved), now = 0, nextTimer = 0
  const timers = new Map(), requests = [], sockets = [], probes = [], udpSockets = [], writes = [], errors = []
  const offlineHosts = new Set(offline)
  const clock = {
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    setInterval(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay, interval: delay }); return id },
    clearInterval(id) { timers.delete(id) }
  }
  function load(file, dependencies = {}) {
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(require.resolve(file), 'utf8'), {
      module, require: name => {
        assert.ok(dependencies[name], 'unexpected dependency: ' + name)
        return dependencies[name]
      }, ...clock
    }, { filename: file })
    return module.exports
  }
  const remote = load('../../lib/remote')
  const discovery = load('../../lib/discovery', { './remote': remote })
  const wx = {
    getStorageSync(key) { assert.equal(key, 'lime-session-v1'); return copy(stored) },
    setStorageSync(key, value) {
      assert.equal(key, 'lime-session-v1'); stored = copy(value); writes.push(copy(value))
    },
    removeStorageSync(key) { assert.equal(key, 'lime-session-v1'); stored = null; writes.push(null) },
    showToast(value) { errors.push(value.title) },
    createTCPSocket() {
      const socket = {
        closed: false,
        onConnect(fn) { this.connected = fn }, onMessage(fn) { this.message = fn },
        onError(fn) { this.error = fn }, onClose(fn) { this.ended = fn },
        connect(endpoint) {
          this.endpoint = copy(endpoint)
          queueMicrotask(() => {
            if (!this.closed) offlineHosts.has(endpoint.address) ? this.error() : this.connected()
          })
        },
        write(data) {
          assert.equal(this.closed, false)
          assert.ok(data.endsWith('\n'))
          requests.push({ socket: this, ...JSON.parse(data) })
        },
        close() { this.closed = true; this.ended() }
      }
      sockets.push(socket)
      return socket
    },
    createUDPSocket() {
      const socket = {
        closed: false,
        onMessage(fn) { this.message = fn }, onError(fn) { this.error = fn }, bind() {},
        send(value) {
          const probe = JSON.parse(value.message)
          probes.push({ ...value, message: probe })
          for (const device of devices) {
            this.message({
              message: Buffer.from(JSON.stringify({ v: 1, type: 'lime-browser', nonce: probe.nonce,
                deviceId: device.deviceId, port: device.port })),
              remoteInfo: { address: device.host }
            })
          }
        },
        close() { this.closed = true }
      }
      udpSockets.push(socket)
      return socket
    }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../../pages/remote/remote.js'), 'utf8'), {
    Page: value => { page = value }, wx, ...clock,
    require: name => name === '../../lib/remote' ? remote : name === '../../lib/discovery' ? discovery
      : require(name)
  }, { filename: 'pages/remote/remote.js' })
  page.setData = value => Object.assign(page.data, value)
  page.onLoad()
  page.visible = true
  t.after(() => {
    page.onUnload()
    assert.equal(timers.size, 0, 'all connection, discovery and polling timers must be cancelled')
    assert.ok(sockets.every(socket => socket.closed))
    assert.ok(udpSockets.every(socket => socket.closed))
  })
  const harness = {
    page, requests, sockets, probes, udpSockets, writes, errors, offlineHosts, flush,
    stored: () => copy(stored),
    last(op) {
      const request = requests.at(-1)
      assert.equal(request && request.op, op)
      return request
    },
    reply(fields = {}, request = requests.at(-1)) {
      request.socket.message({ message: Buffer.from(JSON.stringify({ id: request.id, ok: true, ...fields }) + '\n') })
    },
    async info(device) {
      assert.equal(harness.last('info').token, '', 'identity lookup must not disclose credentials')
      harness.reply({ deviceId: device.deviceId })
      await flush()
    },
    async approve(token) {
      assert.equal(harness.last('authorize').token, '', 'approval must not carry a stale token')
      harness.reply({ token })
      await flush()
      assert.equal(harness.last('status').token, token)
      harness.reply()
      await flush()
    },
    async tick(ms) {
      const end = now + ms
      while (true) {
        const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry) break
        const [id, timer] = entry
        now = timer.at
        if (timer.interval) timer.at += timer.interval
        else timers.delete(id)
        timer.fn()
        await flush()
      }
      now = end
      await flush()
    }
  }
  return harness
}

module.exports = { authorizationHarness }
