const { RemoteClient, parsePairing } = require('../../lib/remote')
const { Discovery, readSession } = require('../../lib/discovery')
const { emptyMedia, mediaView, formatTime, sliderTarget } = require('../../lib/media')
const websites = [
  { id: 'youtube', name: 'YouTube', badge: '▶', color: '#d93025', url: 'https://www.youtube.com/' },
  { id: 'bilibili', name: 'Bilibili', badge: '哔', color: '#d94d82', url: 'https://www.bilibili.com/' },
  { id: 'netflix', name: 'Netflix', badge: 'N', color: '#c8202b', url: 'https://www.netflix.com/' }
]
Page({
  data: { connected: false, busy: false, status: '正在寻找电视…', host: '', port: '8877', code: '', text: '', manual: false, devices: [],
    media: emptyMedia(), mediaBusy: false, fullscreenBusy: false, websites, openingWebsite: '' },
  onLoad() {
    this.epoch = 0
    this.discovery = new Discovery(wx)
    this.client = new RemoteClient(wx, message => {
      if (!this.data.connected) return
      clearInterval(this.heartbeat)
      this.stopMediaPolling()
      this.clearMotion()
      this.setData({ connected: false, busy: false, fullscreenBusy: false, status: message })
      if (this.visible) this.retry = setTimeout(() => this.find(), 3000)
    })
  },
  onShow() { this.visible = true; this.find() },
  onHide() { this.visible = false; this.disconnect() },
  onUnload() { this.visible = false; this.disconnect() },
  field(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }) },
  toggleManual() { this.setData({ manual: !this.data.manual }) },
  async find() {
    if (!this.visible || this.data.busy || this.data.connected) return
    clearTimeout(this.retry)
    const epoch = ++this.epoch
    this.setData({ busy: true, devices: [], status: '正在寻找电视…' })
    const saved = readSession(wx)
    if (saved) {
      try {
        await this.attach(saved, saved, epoch, 1500)
        return
      } catch (_) { if (epoch !== this.epoch || !this.visible) return; this.client.close() }
    }
    const devices = await this.discovery.start()
    if (!this.visible || epoch !== this.epoch) return
    this.setData({ busy: false, devices })
    const remembered = saved && devices.find(device => device.deviceId === saved.deviceId)
    const selected = remembered || (devices.length === 1 ? devices[0] : null)
    if (selected) return this.choose(selected)
    this.setData({ status: devices.length ? '发现多台电视，请选择' : '未找到电视，请打开电视上的青柠浏览器' })
  },
  async choose(value) {
    if (this.data.busy) return
    const device = value.currentTarget ? this.data.devices[value.currentTarget.dataset.index] : value
    if (!device) return
    const epoch = ++this.epoch
    const saved = readSession(wx)
    this.setData({ busy: true, status: '正在连接电视…' })
    try { await this.attach(device, saved && saved.deviceId === device.deviceId ? saved : null, epoch) }
    catch (error) { if (epoch === this.epoch) { this.client.close(); if (this.visible) this.error(error) } }
    finally { if (epoch === this.epoch) this.setData({ busy: false }) }
  },
  async attach(device, saved, epoch, timeout = 6000, code) {
    await this.client.connect(device, timeout)
    const info = await this.client.request('info')
    this.mediaSupported = info.mediaControl === 1
    this.fullscreenSupported = info.fullscreenControl === 1
    if (device.deviceId && info.deviceId !== device.deviceId) throw new Error('盒子地址已变化，正在重新查找')
    if (!/^[a-f0-9-]{36}$/.test(info.deviceId)) throw new Error('电视版本过旧，请更新青柠浏览器')
    if (!this.visible || epoch !== this.epoch) throw new Error('连接取消')
    if (saved) {
      this.client.token = saved.token
      try { await this.client.request('status') }
      catch (error) {
        if (error.code !== 'unauthorized') throw error
        wx.removeStorageSync('lime-session-v1')
        saved = null
      }
    }
    if (!saved) {
      this.setData({ status: code ? '正在配对…' : '请在电视上选择「允许并记住」' })
      const reply = code ? await this.client.pair(code) : await this.client.request('authorize', {}, 35000)
      if (!/^[a-f0-9]{64}$/.test(reply.token)) throw new Error('授权响应无效')
      this.client.token = reply.token
      // Approval has already succeeded; keep it even if the next status request disconnects.
      wx.setStorageSync('lime-session-v1', { host: device.host, port: Number(device.port), deviceId: info.deviceId, token: reply.token })
      await this.client.request('status')
    }
    if (!this.visible || epoch !== this.epoch) throw new Error('连接取消')
    wx.setStorageSync('lime-session-v1', { host: device.host, port: Number(device.port), deviceId: info.deviceId, token: this.client.token })
    this.setData({ connected: true, busy: false, devices: [], status: '已连接青柠浏览器', code: '', manual: false })
    clearInterval(this.heartbeat)
    this.heartbeat = setInterval(() => this.client.request('status').catch(error => this.client.close(error)), 5000)
    this.startMediaPolling()
  },
  scan() {
    this.discovery.stop()
    wx.scanCode({ scanType: ['qrCode'], success: result => {
      try {
        const info = parsePairing(result.result)
        this.setData({ host: info.host, port: String(info.port), code: info.code })
        this.connect()
      } catch (error) { this.error(error) }
    }, fail: error => { if (!/cancel/.test(error.errMsg)) this.error(new Error('无法扫码，请使用手动配对')) } })
  },
  async connect() {
    if (this.data.busy) return
    if (this.data.code && !/^\d{6}$/.test(this.data.code)) return this.error(new Error('请输入电视上的六位配对码'))
    const epoch = ++this.epoch
    this.setData({ busy: true, status: '正在连接…' })
    try { await this.attach({ host: this.data.host.trim(), port: this.data.port }, null, epoch, 6000, this.data.code || null) }
    catch (error) { if (epoch === this.epoch) { this.client.close(); if (this.visible) this.error(error) } }
    finally { if (epoch === this.epoch) this.setData({ busy: false }) }
  },
  disconnect() {
    this.epoch++
    clearTimeout(this.retry)
    clearInterval(this.heartbeat)
    this.stopMediaPolling()
    if (this.discovery) this.discovery.stop()
    this.clearMotion()
    if (this.client) this.client.close()
    this.setData({ connected: false, busy: false, fullscreenBusy: false, status: '已断开，打开小程序可自动重连' })
  },
  error(error) {
    this.setData({ status: error.message })
    wx.showToast({ title: error.message, icon: 'none', duration: 2600 })
  },
  async command(event) {
    try { await this.client.request(event.currentTarget.dataset.op) }
    catch (error) { this.error(error) }
  },
  async toggleFullscreen() {
    if (!this.data.connected || this.data.fullscreenBusy) return
    if (!this.fullscreenSupported) return this.error(new Error('请更新电视浏览器以使用全屏切换'))
    const epoch = this.epoch
    this.setData({ fullscreenBusy: true })
    try { await this.client.request('toggleFullscreen') }
    catch (error) { if (epoch === this.epoch) this.error(error) }
    finally { if (epoch === this.epoch) this.setData({ fullscreenBusy: false }) }
  },
  async openWebsite(event) {
    if (!this.data.connected || this.data.openingWebsite) return
    const website = websites.find(item => item.id === event.currentTarget.dataset.id)
    if (!website) return
    this.setData({ openingWebsite: website.id })
    try {
      await this.client.request('open', { text: website.url })
      wx.showToast({ title: '已在电视打开' + website.name, icon: 'none' })
    } catch (error) { this.error(error) }
    finally { this.setData({ openingWebsite: '' }) }
  },
  startMediaPolling() {
    this.stopMediaPolling()
    if (!this.mediaSupported) {
      this.setData({ media: emptyMedia('请更新电视浏览器以使用视频进度控制') })
      return
    }
    const epoch = this.mediaPollEpoch
    const poll = async () => {
      if (!this.data.connected || epoch !== this.mediaPollEpoch) return
      if (!this.data.mediaBusy) {
        const revision = this.mediaRevision
        try {
          const reply = await this.client.request('mediaStatus')
          if (epoch === this.mediaPollEpoch && revision === this.mediaRevision) this.updateMedia(reply.media)
        } catch (error) {
          if (epoch === this.mediaPollEpoch && revision === this.mediaRevision) {
            this.seekSnapshot = null
            this.setData({ media: emptyMedia(error.message) })
          }
        }
      }
      if (this.data.connected && epoch === this.mediaPollEpoch) this.mediaTimer = setTimeout(poll, 1000)
    }
    poll()
  },
  stopMediaPolling() {
    clearTimeout(this.mediaTimer)
    clearTimeout(this.seekReleaseTimer)
    this.mediaPollEpoch = (this.mediaPollEpoch || 0) + 1
    this.mediaRevision = (this.mediaRevision || 0) + 1
    this.seekSnapshot = null
    this.setData({ media: emptyMedia(), mediaBusy: false })
  },
  updateMedia(value) {
    const media = mediaView(value)
    if (this.seekSnapshot) {
      if (media.mediaId === this.seekSnapshot.mediaId && media.canSeek) return
      this.seekSnapshot = null
    }
    this.setData({ media })
  },
  async mediaCommand(op, fields, mediaId) {
    if (!this.data.connected || this.data.mediaBusy || !mediaId) return
    this.seekSnapshot = null
    const epoch = this.mediaPollEpoch
    this.mediaRevision++
    this.setData({ mediaBusy: true })
    try {
      const reply = await this.client.request(op, Object.assign({}, fields, { mediaId }))
      if (epoch === this.mediaPollEpoch) this.updateMedia(reply.media)
    } catch (error) {
      if (epoch === this.mediaPollEpoch) {
        this.setData({ media: emptyMedia('正在重新读取视频状态…') })
        wx.showToast({ title: error.message, icon: 'none' })
      }
    } finally { if (epoch === this.mediaPollEpoch) this.setData({ mediaBusy: false }) }
  },
  skipMedia(event) {
    if (!this.data.media.canSeek) return
    return this.mediaCommand('seekBy', { seconds: Number(event.currentTarget.dataset.seconds) }, this.data.media.mediaId)
  },
  toggleMedia() { return this.mediaCommand('mediaToggle', {}, this.data.media.mediaId) },
  seekStart() {
    clearTimeout(this.seekReleaseTimer)
    this.seekSnapshot = this.data.media.canSeek && !this.data.mediaBusy ? Object.assign({}, this.data.media) : null
  },
  seekEnd() {
    // A tap without a value change may have no change event. Resume status updates anyway.
    clearTimeout(this.seekReleaseTimer)
    this.seekReleaseTimer = setTimeout(() => { this.seekSnapshot = null }, 500)
  },
  seekChanging(event) {
    if (!this.seekSnapshot) return
    const position = sliderTarget(event.detail.value, this.seekSnapshot)
    this.setData({ 'media.slider': event.detail.value, 'media.currentLabel': formatTime(position) })
  },
  seekChange(event) {
    clearTimeout(this.seekReleaseTimer)
    const snapshot = this.seekSnapshot
    this.seekSnapshot = null
    if (!snapshot || snapshot.mediaId !== this.data.media.mediaId) return
    return this.mediaCommand('seekTo', { seconds: sliderTarget(event.detail.value, snapshot) }, snapshot.mediaId)
  },
  seekCancel() { clearTimeout(this.seekReleaseTimer); this.seekSnapshot = null },
  async send(event) {
    if (!this.data.text.trim()) return
    try { await this.client.request(event.currentTarget.dataset.op, { text: this.data.text }) }
    catch (error) { this.error(error) }
  },
  point(touches) {
    return { x: touches.reduce((sum, t) => sum + t.clientX, 0) / touches.length,
      y: touches.reduce((sum, t) => sum + t.clientY, 0) / touches.length }
  },
  touchStart(event) {
    if (!this.data.connected) return
    this.startTime = Date.now()
    this.travel = 0
    this.multi = event.touches.length > 1
    this.count = event.touches.length
    this.last = this.point(event.touches)
  },
  touchMove(event) {
    if (!this.data.connected || !this.last || !event.touches.length) return
    const point = this.point(event.touches)
    if (event.touches.length !== this.count) {
      this.multi = true
      this.count = event.touches.length
      this.last = point
      return
    }
    const dx = point.x - this.last.x, dy = point.y - this.last.y
    this.travel += Math.abs(dx) + Math.abs(dy)
    this.last = point
    const op = this.count > 1 ? 'scroll' : 'move'
    // Aggregate touch events, then send at most one command per 32ms.
    if (this.motion && this.motion.op !== op) this.flushMotion()
    if (!this.motion) this.motion = { op, dx: 0, dy: 0 }
    this.motion.dx += (op === 'scroll' ? -1 : 1) * dx * 2
    this.motion.dy += (op === 'scroll' ? -1 : 1) * dy * 2
    if (!this.motionTimer) this.motionTimer = setTimeout(() => this.flushMotion(), 32)
  },
  flushMotion() {
    clearTimeout(this.motionTimer)
    this.motionTimer = null
    const motion = this.motion
    this.motion = null
    if (!motion || !this.data.connected) return
    const dx = Math.max(-500, Math.min(500, motion.dx)), dy = Math.max(-500, Math.min(500, motion.dy))
    this.client.request(motion.op, { dx, dy }).catch(error => this.error(error))
  },
  touchEnd(event) {
    if (event.touches.length) { this.multi = true; this.last = this.point(event.touches); this.count = event.touches.length; return }
    this.flushMotion()
    if (this.last && !this.multi && this.travel < 8 && Date.now() - this.startTime < 350) {
      this.client.request('click').catch(error => this.error(error))
    }
    this.last = null
  },
  clearMotion() { clearTimeout(this.motionTimer); this.motionTimer = null; this.motion = null; this.last = null },
  touchCancel() { this.clearMotion() }
})
