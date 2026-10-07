// NDJSON over wx.createTCPSocket. No server domains or cloud relay required.
const MAX_FRAME = 16384
const ERRORS = {
  approval_busy: '电视正在处理连接请求，请稍后重试',
  approval_denied: '电视未允许连接，请重试并在电视上确认',
  pair_failed: '配对失败或配对码过期，请在电视上重新配对',
  unauthorized: '手机授权已失效，请在电视上重新确认',
  background: '浏览器已离开前台，请在电视上打开青柠浏览器',
  no_input: '请先点击电视网页里的输入框',
  not_ready: '网页尚未就绪，请稍后重试',
  invalid_url: '只支持网址或搜索词',
  rate_limited: '操作太快，请稍后重试'
}
function validateEndpoint(value) {
  if (!value || !/^\d+\.\d+\.\d+\.\d+$/.test(value.host)) throw new Error('请输入盒子的局域网 IPv4 地址')
  const parts = value.host.split('.').map(Number)
  if (parts.some(n => n < 0 || n > 255) || !(parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168))) {
    throw new Error('只支持家中局域网地址')
  }
  const port = Number(value.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效')
  return { host: value.host, port }
}
function parsePairing(raw) {
  let value
  try { value = JSON.parse(raw) } catch (_) { throw new Error('请扫描青柠浏览器的配对二维码') }
  if (value.v !== 1 || !/^\d{6}$/.test(value.code)) throw new Error('配对二维码无效')
  return Object.assign(validateEndpoint(value), { code: value.code })
}
// Buffer bytes until a complete newline: UTF-8 Chinese characters can straddle TCP packets.
function decodeUtf8(bytes) {
  const escaped = bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join('')
  return decodeURIComponent(escaped)
}
class RemoteClient {
  constructor(wxApi, onDisconnect = () => {}) {
    this.wx = wxApi
    this.onDisconnect = onDisconnect
    this.sequence = 0
    this.pending = new Map()
    this.buffer = []
    this.socket = null
    this.token = ''
  }
  connect(endpoint, timeout = 6000) {
    this.close()
    this.endpoint = validateEndpoint(endpoint)
    if (!this.wx.createTCPSocket) return Promise.reject(new Error('请升级微信后重试'))
    return new Promise((resolve, reject) => {
      const socket = this.wx.createTCPSocket()
      this.socket = socket
      this.connectReject = reject
      this.connectTimer = setTimeout(() => this.close(new Error('连接超时，请确认手机和盒子在同一 Wi-Fi')), timeout)
      socket.onConnect(() => {
        if (this.socket !== socket) return
        clearTimeout(this.connectTimer)
        this.connectReject = null
        resolve()
      })
      socket.onMessage(event => {
        if (this.socket !== socket) return
        try { this.receive(event.message) } catch (_) { this.close(new Error('收到无效数据，请重新配对')) }
      })
      socket.onError(() => { if (this.socket === socket) this.close(new Error('连接失败，请检查 Wi-Fi 和本地网络权限')) })
      socket.onClose(() => { if (this.socket === socket) this.close(new Error('连接已断开，请重新连接')) })
      socket.connect({ address: this.endpoint.host, port: this.endpoint.port })
    })
  }
  receive(message) {
    const bytes = new Uint8Array(message)
    for (const b of bytes) {
      if (b !== 10) {
        this.buffer.push(b)
        if (this.buffer.length > MAX_FRAME) throw new Error('frame_too_large')
        continue
      }
      const reply = JSON.parse(decodeUtf8(this.buffer))
      this.buffer = []
      const request = this.pending.get(reply.id)
      if (!request) continue
      clearTimeout(request.timer)
      this.pending.delete(reply.id)
      if (reply.ok) request.resolve(reply)
      else request.reject(Object.assign(new Error(ERRORS[reply.error] || '操作失败：' + reply.error), { code: reply.error }))
    }
  }
  request(op, fields = {}, timeout = 4000) {
    if (!this.socket) return Promise.reject(new Error('请先连接电视'))
    if (this.pending.size >= 8) return Promise.reject(new Error('网络繁忙，请稍后重试'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // Never automatically replay commands after a timeout.
        reject(new Error('操作超时，请检查连接'))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try { this.socket.write(JSON.stringify(Object.assign({}, fields, { id, op, token: this.token })) + '\n') }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  async pair(code) {
    const reply = await this.request('pair', { code })
    if (!/^[a-f0-9]{64}$/.test(reply.token)) throw new Error('配对响应无效')
    this.token = reply.token
    return reply
  }
  close(reason) {
    const socket = this.socket
    this.socket = null
    this.buffer = []
    this.token = ''
    clearTimeout(this.connectTimer)
    if (this.connectReject) { this.connectReject(reason || new Error('连接取消')); this.connectReject = null }
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(reason || new Error('连接已关闭'))
    }
    this.pending.clear()
    if (socket) socket.close()
    if (reason) this.onDisconnect(reason.message)
  }
}
module.exports = { RemoteClient, parsePairing, validateEndpoint, decodeUtf8 }
