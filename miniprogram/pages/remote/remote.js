const { RemoteClient, parsePairing } = require('../../lib/remote')
const { Discovery, readSession } = require('../../lib/discovery')
const { emptyMedia, mediaView, formatTime, sliderTarget } = require('../../lib/media')
const { emptyVolume, volumeView } = require('../../lib/volume')
const websites = [
  { id: 'youtube', name: 'YouTube', badge: '▶', color: '#d93025', url: 'https://www.youtube.com/' },
  { id: 'bilibili', name: 'Bilibili', badge: '哔', color: '#d94d82', url: 'https://www.bilibili.com/' },
  { id: 'netflix', name: 'Netflix', badge: 'N', color: '#c8202b', url: 'https://www.netflix.com/' }
]
Page({
  data: { connected: false, busy: false, status: '正在寻找电视…', host: '', port: '8877', code: '', text: '', manual: false, devices: [],
    navigation: false, focusedControl: '', showDirections: false, navigationSupported: false, media: emptyMedia(), mediaBusy: false, qualityChoices: [], fullscreenBusy: false, volume: emptyVolume(), volumeBusy: false, websites, openingWebsite: '' },
  onLoad() {
    this.epoch = 0
    this.discovery = new Discovery(wx)
    this.client = new RemoteClient(wx, message => {
      if (!this.data.connected) return
      this.epoch++
      this.stopHeartbeat()
      this.stopMediaPolling()
      this.stopVolumePolling()
      this.clearMotion()
      this.setData({ connected: false, navigation: false, focusedControl: '', busy: false, fullscreenBusy: false, status: message })
      if (this.visible) this.retry = setTimeout(() => this.find(), 3000)
    }, ui => this.updateUi(ui))
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
    this.volumeSupported = info.volumeControl === 1
    this.setData({ navigationSupported: info.uiNavigation === 1 })
    this.qualitySupported = info.qualityControl === 1
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
    this.startHeartbeat()
    this.startMediaPolling()
    this.startVolumePolling()
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
    this.stopHeartbeat()
    this.stopMediaPolling()
    this.stopVolumePolling()
    if (this.discovery) this.discovery.stop()
    this.clearMotion()
    if (this.client) this.client.close()
    this.setData({ connected: false, navigation: false, focusedControl: '', busy: false, fullscreenBusy: false, status: '已断开，打开小程序可自动重连' })
  },
  error(error) {
    if (error.code !== 'client_busy') this.setData({ status: error.message })
    wx.showToast({ title: error.message, icon: 'none', duration: 2600 })
  },
  startHeartbeat() {
    this.stopHeartbeat()
    const epoch = this.heartbeatEpoch
    let timeouts = 0
    const poll = async () => {
      if (!this.data.connected || epoch !== this.heartbeatEpoch) return
      try {
        await this.client.request('status')
        timeouts = 0
      } catch (error) {
        // A late rejection from an old connection must never close the new one.
        if (!this.data.connected || epoch !== this.heartbeatEpoch) return
        if (error.code === 'request_timeout') {
          if (++timeouts >= 2) { this.client.close(error); return }
        } else if (!['client_busy', 'not_ready', 'rate_limited'].includes(error.code)) {
          this.client.close(error)
          return
        } else if (error.code !== 'client_busy') timeouts = 0
      }
      if (this.data.connected && epoch === this.heartbeatEpoch) this.heartbeat = setTimeout(poll, 1000)
    }
    this.heartbeat = setTimeout(poll, 1000)
  },
  stopHeartbeat() {
    clearTimeout(this.heartbeat)
    this.heartbeatEpoch = (this.heartbeatEpoch || 0) + 1
  },
  updateUi(ui) {
    if (!ui || !['pointer', 'navigation'].includes(ui.mode)) return
    const navigation = ui.mode === 'navigation'
    if (navigation !== this.data.navigation) {
      this.clearMotion()
      this.setData({ showDirections: navigation })
    }
    this.setData({ navigation, focusedControl: typeof ui.focus === 'string' ? ui.focus.slice(0, 120) : '' })
  },
  toggleDirections() { this.setData({ showDirections: !this.data.showDirections }) },
  async command(event) {
    // Discard any unfinished drag before changing the TV's interface.
    this.clearMotion()
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
      if (!this.data.mediaBusy && this.client.canRequest('mediaStatus')) {
        const revision = this.mediaRevision
        try {
          const reply = await this.client.request('mediaStatus')
          if (epoch === this.mediaPollEpoch && revision === this.mediaRevision) this.updateMedia(reply.media)
        } catch (error) {
          if (epoch === this.mediaPollEpoch && revision === this.mediaRevision) {
            this.seekSnapshot = null
            this.setData({ media: emptyMedia(error.message), qualityChoices: [] })
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
    this.setData({ media: emptyMedia(), mediaBusy: false, qualityChoices: [] })
  },
  updateMedia(value) {
    const media = mediaView(value)
    if (this.qualitySupported === false && media.available) media.quality.hint = '请更新电视浏览器以使用清晰度切换'
    const choices = this.data.qualityChoices
    if (choices.length && (choices[0].mediaId !== media.mediaId || !media.quality.supported ||
        choices.map(choice => choice.id).join(',') !== media.quality.options.map(option => option.id).join(','))) {
      this.setData({ qualityChoices: [] })
    }
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
    this.setData({ mediaBusy: true, qualityChoices: [] })
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
    if (!this.data.media.canSeek || this.data.media.quality.switching) return
    return this.mediaCommand('seekBy', { seconds: Number(event.currentTarget.dataset.seconds) }, this.data.media.mediaId)
  },
  toggleMedia() {
    if (!this.data.media.quality.switching) return this.mediaCommand('mediaToggle', {}, this.data.media.mediaId)
  },
  chooseQuality() {
    const media = this.data.media
    if (this.data.mediaBusy || media.quality.switching || !media.quality.supported) return
    this.seekCancel()
    this.setData({ qualityChoices: this.data.qualityChoices.length ? [] :
      media.quality.options.map(option => Object.assign({}, option, { mediaId: media.mediaId })) })
  },
  setQuality(event) {
    const { id, mediaId } = event.currentTarget.dataset
    if (mediaId !== this.data.media.mediaId || !this.data.qualityChoices.some(choice => choice.id === id && choice.mediaId === mediaId)) return
    return this.mediaCommand('setQuality', { qualityId: id }, mediaId)
  },
  seekStart() {
    clearTimeout(this.seekReleaseTimer)
    this.seekSnapshot = this.data.media.canSeek && !this.data.mediaBusy && !this.data.media.quality.switching ? Object.assign({}, this.data.media) : null
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
  startVolumePolling() {
    this.stopVolumePolling()
    if (!this.volumeSupported) {
      this.setData({ volume: emptyVolume('请更新电视浏览器以使用音量控制') })
      return
    }
    const epoch = this.volumePollEpoch
    const poll = async () => {
      if (!this.data.connected || epoch !== this.volumePollEpoch) return
      if (!this.data.volumeBusy && !this.volumeDrag && this.client.canRequest('volumeStatus')) {
        const revision = this.volumeRevision
        try {
          const reply = await this.client.request('volumeStatus')
          if (epoch === this.volumePollEpoch && revision === this.volumeRevision && !this.volumeDrag) {
            this.setData({ volume: volumeView(reply.volume) })
          }
        } catch (error) {
          if (epoch === this.volumePollEpoch && revision === this.volumeRevision && !this.volumeDrag) {
            this.setData({ volume: emptyVolume(error.message) })
          }
        }
      }
      if (this.data.connected && epoch === this.volumePollEpoch) this.volumeTimer = setTimeout(poll, 1000)
    }
    poll()
  },
  stopVolumePolling() {
    clearTimeout(this.volumeTimer)
    clearTimeout(this.volumeReleaseTimer)
    this.volumePollEpoch = (this.volumePollEpoch || 0) + 1
    this.volumeRevision = (this.volumeRevision || 0) + 1
    this.volumeDrag = null
    this.setData({ volume: emptyVolume(), volumeBusy: false })
  },
  async volumeCommand(op, fields) {
    if (!this.data.connected || !this.data.volume.supported || this.data.volumeBusy) return
    const epoch = this.volumePollEpoch
    this.volumeRevision++
    this.volumeCancel()
    this.setData({ volumeBusy: true })
    try {
      const reply = await this.client.request(op, fields)
      if (epoch === this.volumePollEpoch) this.setData({ volume: volumeView(reply.volume) })
    } catch (error) {
      if (epoch === this.volumePollEpoch) {
        this.setData({ volume: emptyVolume('正在重新读取盒子音量…') })
        wx.showToast({ title: error.message, icon: 'none' })
      }
    } finally { if (epoch === this.volumePollEpoch) this.setData({ volumeBusy: false }) }
  },
  volumeStart() {
    clearTimeout(this.volumeReleaseTimer)
    this.volumeDrag = this.data.connected && this.data.volume.supported && !this.data.volumeBusy
      ? { epoch: this.volumePollEpoch, volume: Object.assign({}, this.data.volume) } : null
  },
  volumeEnd() {
    clearTimeout(this.volumeReleaseTimer)
    this.volumeReleaseTimer = setTimeout(() => this.volumeCancel(), 500)
  },
  volumeChanging(event) {
    if (this.volumeDrag) this.setData({ 'volume.percent': event.detail.value })
  },
  volumeChange(event) {
    const drag = this.volumeDrag
    this.volumeCancel()
    if (!drag || drag.epoch !== this.volumePollEpoch) return
    return this.volumeCommand('setVolume', { percent: event.detail.value })
  },
  volumeCancel() {
    clearTimeout(this.volumeReleaseTimer)
    if (this.volumeDrag) this.setData({ volume: this.volumeDrag.volume })
    this.volumeDrag = null
  },
  muteChange(event) { return this.volumeCommand('setMuted', { muted: event.detail.value }) },
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
    // An additional finger starts a new centroid, but keeps an already locked scroll axis.
    const keepAxis = this.last && this.multi && event.touches.length > 1
    const axis = keepAxis ? this.scrollAxis : null
    const gestureId = keepAxis ? this.scrollGestureId : `${this.epoch}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    this.clearMotion()
    this.scrollAxis = axis
    this.scrollGestureId = gestureId
    this.scrollX = this.scrollY = 0
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
      this.scrollX = this.scrollY = 0
      this.motion = null
      return
    }
    let dx = point.x - this.last.x, dy = point.y - this.last.y
    this.travel += Math.abs(dx) + Math.abs(dy)
    this.last = point
    // Lifting one finger during a scroll must not turn the remainder into pointer input.
    if (this.multi && this.count < 2) return
    const op = this.count > 1 ? 'scroll' : 'move'
    if (op === 'scroll') {
      if (!this.scrollAxis) {
        this.scrollX += dx; this.scrollY += dy
        const x = Math.abs(this.scrollX), y = Math.abs(this.scrollY)
        if (Math.max(x, y) < 6 || (Math.max(x, y) < 16 && Math.max(x, y) < Math.min(x, y) * 1.35)) return
        this.scrollAxis = x > y ? 'x' : 'y'
        dx = this.scrollX; dy = this.scrollY
      }
      if (this.scrollAxis === 'x') dy = 0
      else dx = 0
    }
    // Aggregate touch events, then send at most one command per 32ms.
    if (this.motion && this.motion.op !== op) this.motion = null
    if (!this.motion) this.motion = { op, dx: 0, dy: 0, gestureId: this.scrollGestureId }
    this.motion.dx = Math.max(-500, Math.min(500, this.motion.dx + (op === 'scroll' ? -1 : 1) * dx * 2))
    this.motion.dy = Math.max(-500, Math.min(500, this.motion.dy + (op === 'scroll' ? -1 : 1) * dy * 2))
    if (!this.motionTimer && (!this.motionFlight || this.motionFlight.epoch !== this.epoch)) this.motionTimer = setTimeout(() => this.flushMotion(), 32)
  },
  flushMotion() {
    clearTimeout(this.motionTimer)
    this.motionTimer = null
    // Merge subsequent movement while the TV is replying, rather than filling its queue.
    if (this.motionFlight && this.motionFlight.epoch === this.epoch) return
    const motion = this.motion
    this.motion = null
    if (!motion || !this.data.connected) return
    const dx = Math.max(-500, Math.min(500, motion.dx)), dy = Math.max(-500, Math.min(500, motion.dy))
    if (!dx && !dy) return
    const revision = this.motionRevision
    const epoch = this.epoch
    const flight = { epoch }
    this.motionFlight = flight
    const fields = { dx, dy }
    if (motion.op === 'scroll') fields.gestureId = motion.gestureId
    this.client.request(motion.op, fields).catch(error => {
      if (epoch === this.epoch && revision === this.motionRevision && this.data.connected) {
        this.clearMotion()
        if (error.code !== 'client_busy') this.error(error)
      }
    }).finally(() => {
      if (this.motionFlight !== flight) return
      this.motionFlight = null
      if (this.motion && this.data.connected && epoch === this.epoch && !this.motionTimer) {
        this.motionTimer = setTimeout(() => this.flushMotion(), 32)
      }
    })
  },
  touchEnd(event) {
    if (event.touches.length) { this.multi = true; this.last = this.point(event.touches); this.count = event.touches.length; return }
    this.flushMotion()
    if (this.last && !this.multi && this.travel < 8 && Date.now() - this.startTime < 350) {
      this.client.request('click').catch(error => this.error(error))
    }
    this.last = null
  },
  clearMotion() {
    clearTimeout(this.motionTimer); this.motionTimer = null; this.motion = null; this.last = null
    this.scrollAxis = null; this.scrollX = this.scrollY = 0
    this.motionRevision = (this.motionRevision || 0) + 1
  },
  touchCancel() { this.clearMotion() }
})
