const { validateEndpoint, decodeUtf8 } = require('./remote')
const DEVICE_ID = /^[a-f0-9-]{36}$/
function parseDiscovery(event, nonce) {
  if (!event.message || event.message.byteLength > 512) throw new Error('invalid_discovery')
  const value = JSON.parse(decodeUtf8(Array.from(new Uint8Array(event.message))))
  if (value.v !== 1 || value.type !== 'lime-browser' || value.nonce !== nonce || !DEVICE_ID.test(value.deviceId)) throw new Error('invalid_discovery')
  const endpoint = validateEndpoint({ host: event.remoteInfo.address, port: value.port })
  return Object.assign(endpoint, { deviceId: value.deviceId, name: '青柠浏览器' })
}
function readSession(wxApi) {
  try {
    const value = wxApi.getStorageSync('lime-session-v1')
    if (!value || !DEVICE_ID.test(value.deviceId) || !/^[a-f0-9]{64}$/.test(value.token)) return null
    return Object.assign({}, validateEndpoint(value), { deviceId: value.deviceId, token: value.token })
  } catch (_) { return null }
}
class Discovery {
  constructor(wxApi) { this.wx = wxApi }
  start(duration = 4000) {
    this.stop()
    if (!this.wx.createUDPSocket) return Promise.resolve([])
    return new Promise(resolve => {
      this.resolve = resolve
      this.devices = new Map()
      const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      try {
        const socket = this.wx.createUDPSocket()
        this.socket = socket
        socket.onMessage(event => {
          if (this.socket !== socket) return
          try {
            const value = parseDiscovery(event, nonce)
            if (this.devices.size < 32) this.devices.set(value.deviceId, value)
          } catch (_) { /* Other LAN packets are not discovery replies. */ }
        })
        socket.onError(() => this.stop())
        socket.bind()
        const probe = () => {
          try { socket.send({ address: '255.255.255.255', port: 8878, setBroadcast: true,
            message: JSON.stringify({ v: 1, type: 'lime-discover', nonce }) }) }
          catch (_) { this.stop() }
        }
        this.interval = setInterval(probe, 1000)
        this.timer = setTimeout(() => this.stop(), duration)
        probe()
      } catch (_) { this.stop() }
    })
  }
  stop() {
    clearInterval(this.interval)
    clearTimeout(this.timer)
    const socket = this.socket
    this.socket = null
    if (socket) socket.close()
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve(Array.from(this.devices.values()))
    }
  }
}
module.exports = { Discovery, readSession, parseDiscovery }
