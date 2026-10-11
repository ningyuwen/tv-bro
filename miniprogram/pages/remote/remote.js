const { RemoteClient, parsePairing } = require('../../lib/remote')
const { Discovery, readSession } = require('../../lib/discovery')
const { emptyMedia, mediaView, formatTime, sliderTarget } = require('../../lib/media')
const { emptyVolume, volumeView } = require('../../lib/volume')
const { DEFAULT_PREFERENCES, normalizePreferences, readPreferences, savePreferences, motionScale } = require('../../lib/preferences')
const websites = [
  { id: 'youtube', name: 'YouTube', badge: '▶', color: '#d93025', url: 'https://www.youtube.com/' },
  { id: 'bilibili', name: 'Bilibili', badge: '哔', color: '#d94d82', url: 'https://www.bilibili.com/' },
  { id: 'netflix', name: 'Netflix', badge: 'N', color: '#c8202b', url: 'https://www.netflix.com/' }
]
Page({
  data: { connected: false, busy: false, connectionAction: '', status: '正在寻找电视…', host: '', port: '8877', code: '', manual: false, devices: [],
    preferences: DEFAULT_PREFERENCES, showTouchSettings: false, inputMode: 'open', openText: '', pageText: '', inputBusy: false, inputStatus: '',
    navigation: false, focusedControl: '', showDirections: false, navigationSupported: false, media: emptyMedia(), mediaBusy: false, qualityChoices: [], fullscreenBusy: false, volume: emptyVolume(), volumeBusy: false, websites, openingWebsite: '' },
  onLoad() {
    this.epoch = 0
    this.autoFind = true
    this.retryAttempt = 0
    this.approvalAttempts = new Set()
    this.setData({ preferences: readPreferences(wx) })
    this.discovery = new Discovery(wx)
    this.client = new RemoteClient(wx, message => {
      if (!this.data.connected) return
      this.epoch++
      this.stopHeartbeat()
      this.stopMediaPolling()
      this.stopVolumePolling()
      this.clearMotion()
      this.setData({ connected: false, navigation: false, focusedControl: '', busy: false, fullscreenBusy: false, inputBusy: false, inputStatus: '', status: message })
      this.scheduleFind(message)
    }, ui => this.updateUi(ui))
  },
  onShow() { this.visible = true; this.autoFind = true; this.retryAttempt = 0; this.find(true) },
  onHide() { this.visible = false; this.disconnect() },
  onUnload() { this.visible = false; this.disconnect() },
  field(event) {
    const field = event.currentTarget.dataset.field
    if (['openText', 'pageText'].includes(field)) {
      this.inputRevision = (this.inputRevision || 0) + 1
      this.setData({ [field]: event.detail.value, inputStatus: '' })
    } else this.setData({ [field]: event.detail.value })
  },
  toggleManual() { this.setData({ manual: !this.data.manual }) },
  scheduleFind(message) {
    clearTimeout(this.retry)
    if (!this.visible || this.autoFind === false || this.data.connected || this.scanning) return
    const delay = Math.min(15000, 3000 * Math.pow(2, Math.min(this.retryAttempt || 0, 3)))
    this.retryAttempt = (this.retryAttempt || 0) + 1
    this.setData({ status: `${message}；${delay / 1000} 秒后自动重试` })
    this.retry = setTimeout(() => { this.retry = null; this.find(true) }, delay)
  },
  async find(automatic = false) {
    if (!this.visible || this.scanning || this.data.busy || this.data.connected) return
    automatic = automatic === true
    this.autoFind = true
    if (!automatic) this.retryAttempt = 0
    clearTimeout(this.retry)
    this.retry = null
    const epoch = ++this.epoch
    this.setData({ busy: true, connectionAction: 'find', status: this.retryAttempt ? '正在重新寻找电视…' : '正在寻找电视…' })
    const saved = readSession(wx)
    if (saved) {
      try {
        await this.attach(saved, saved, epoch, 1500, null, automatic)
        return
      } catch (error) {
        if (epoch !== this.epoch || !this.visible) return
        this.client.close()
        // Discovery can recover an old address, but must not repeat a failed
        // TV approval (or replace its error with approval_busy).
        if (error.authorizationFailed) {
          this.setData({ busy: false, connectionAction: '', status: error.message })
          if (!automatic) this.error(error)
          this.scheduleFind(error.message)
          return
        }
      }
    }
    let devices
    try { devices = await this.discovery.start() }
    catch (error) {
      if (!this.visible || epoch !== this.epoch) return
      this.setData({ busy: false, connectionAction: '' })
      this.scheduleFind(error.message || '暂时无法寻找电视')
      return
    }
    if (!this.visible || epoch !== this.epoch) return
    this.setData({ busy: false, connectionAction: '', devices })
    const remembered = saved && devices.find(device => device.deviceId === saved.deviceId)
    const selected = remembered || (devices.length === 1 ? devices[0] : null)
    if (selected && (!automatic || remembered || !this.approvalAttempts || !this.approvalAttempts.has(selected.deviceId))) {
      return this.choose(selected, automatic)
    }
    this.scheduleFind(selected ? '请点选电视重新授权，并在电视上确认' : devices.length ? '发现多台电视，请选择' : '未找到电视，请打开电视上的青柠浏览器并确认连接同一 Wi-Fi')
  },
  async choose(value, automatic = false) {
    const explicit = value && value.currentTarget && automatic !== true
    const device = value && value.currentTarget ? this.data.devices[value.currentTarget.dataset.index] : value
    if (!device || this.scanning) return
    if (this.data.busy) {
      if (!explicit || this.data.connectionAction !== 'find') return
      // Invalidate the in-flight search before stopping it or closing its socket.
      this.epoch++
      this.discovery.stop()
      this.client.close()
    }
    this.autoFind = true
    clearTimeout(this.retry)
    this.retry = null
    const epoch = ++this.epoch
    const saved = readSession(wx)
    this.setData({ busy: true, connectionAction: 'device', status: '正在连接电视…' })
    let failure
    try { await this.attach(device, saved && saved.deviceId === device.deviceId ? saved : null, epoch, 6000, null, automatic === true) }
    catch (error) {
      if (epoch === this.epoch) {
        failure = error
        this.client.close()
        if (this.visible && !automatic) this.error(error)
      }
    }
    finally {
      if (epoch === this.epoch) {
        this.setData({ busy: false, connectionAction: '' })
        if (failure) this.scheduleFind(failure.message)
      }
    }
  },
  async attach(device, saved, epoch, timeout = 6000, code, automatic = false) {
    const client = this.client
    const ensureCurrent = () => {
      if (!this.visible || epoch !== this.epoch || client !== this.client) throw new Error('连接取消')
    }
    await client.connect(device, timeout)
    ensureCurrent()
    const info = await client.request('info')
    ensureCurrent()
    if (device.deviceId && info.deviceId !== device.deviceId) throw new Error('盒子地址已变化，正在重新查找')
    if (!/^[a-f0-9-]{36}$/.test(info.deviceId)) throw new Error('电视版本过旧，请更新青柠浏览器')
    this.mediaSupported = info.mediaControl === 1
    this.fullscreenSupported = info.fullscreenControl === 1
    this.volumeSupported = info.volumeControl === 1
    this.setData({ navigationSupported: info.uiNavigation === 1 })
    this.qualitySupported = info.qualityControl === 1
    if (saved) {
      client.token = saved.token
      try { await client.request('status'); ensureCurrent() }
      catch (error) {
        ensureCurrent()
        if (error.code !== 'unauthorized') throw error
        wx.removeStorageSync('lime-session-v1')
        client.token = ''
        saved = null
      }
    }
    if (!saved) {
      if (!this.approvalAttempts) this.approvalAttempts = new Set()
      if (automatic && this.approvalAttempts.has(info.deviceId)) {
        throw Object.assign(new Error('请点选电视重新授权，并在电视上确认'), { code: 'authorization_required' })
      }
      this.approvalAttempts.add(info.deviceId)
      this.setData({ status: code ? '正在配对…' : '等待电视确认：请选择「允许并记住」' })
      try {
        // Page ownership must be checked before assigning the token, including QR pairing.
        const reply = code ? await client.request('pair', { code }) : await client.request('authorize', {}, 35000)
        ensureCurrent()
        if (!/^[a-f0-9]{64}$/.test(reply.token)) throw new Error('授权响应无效')
        client.token = reply.token
        // Approval has already succeeded; keep it even if the next status request disconnects.
        wx.setStorageSync('lime-session-v1', { host: device.host, port: Number(device.port), deviceId: info.deviceId, token: reply.token })
      } catch (error) {
        error.authorizationFailed = true
        throw error
      }
      await client.request('status')
      ensureCurrent()
    }
    wx.setStorageSync('lime-session-v1', { host: device.host, port: Number(device.port), deviceId: info.deviceId, token: client.token })
    this.retryAttempt = 0
    clearTimeout(this.retry)
    this.retry = null
    this.setData({ connected: true, busy: false, connectionAction: '', devices: [], status: '已连接青柠浏览器', code: '', manual: false })
    this.startHeartbeat()
    this.startMediaPolling()
    this.startVolumePolling()
  },
  scan() {
    if (this.data.busy || this.scanning) return
    clearTimeout(this.retry)
    this.retry = null
    this.autoFind = true
    this.scanning = true
    const operation = { epoch: this.epoch }
    this.scanOperation = operation
    const current = () => this.scanOperation === operation && this.visible && this.epoch === operation.epoch
    this.discovery.stop()
    wx.scanCode({ scanType: ['qrCode'], success: result => {
      if (!current()) return
      try {
        const info = parsePairing(result.result)
        this.scanning = false
        this.scanOperation = null
        this.setData({ host: info.host, port: String(info.port), code: info.code })
        this.connect()
      } catch (error) { this.error(error) }
    }, fail: error => {
      if (current() && !/cancel/.test(error.errMsg)) this.error(new Error('无法扫码，请使用手动配对'))
    }, complete: () => {
      if (!current()) return
      this.scanning = false
      this.scanOperation = null
      if (!this.data.connected && !this.data.busy) this.scheduleFind('继续寻找电视')
    } })
  },
  async connect() {
    if (this.data.busy || this.scanning) return
    clearTimeout(this.retry)
    this.retry = null
    this.autoFind = true
    if (this.data.code && !/^\d{6}$/.test(this.data.code)) {
      const error = new Error('请输入电视上的六位配对码')
      this.error(error)
      this.scheduleFind(error.message)
      return
    }
    const epoch = ++this.epoch
    this.stopHeartbeat()
    this.stopMediaPolling()
    this.stopVolumePolling()
    this.clearMotion()
    this.setData({ connected: false, busy: true, connectionAction: 'connect', inputBusy: false, inputStatus: '', status: '正在连接…' })
    let failure
    try { await this.attach({ host: this.data.host.trim(), port: this.data.port }, null, epoch, 6000, this.data.code || null) }
    catch (error) {
      if (epoch === this.epoch) {
        failure = error
        this.client.close()
        if (this.visible) this.error(error)
      }
    }
    finally {
      if (epoch === this.epoch) {
        this.setData({ busy: false, connectionAction: '' })
        if (failure) this.scheduleFind(failure.message)
      }
    }
  },
  disconnect() {
    this.autoFind = false
    this.epoch++
    clearTimeout(this.retry)
    this.retry = null
    this.scanning = false
    this.scanOperation = null
    this.stopHeartbeat()
    this.stopMediaPolling()
    this.stopVolumePolling()
    if (this.discovery) this.discovery.stop()
    this.clearMotion()
    if (this.client) this.client.close()
    this.setData({ connected: false, navigation: false, focusedControl: '', busy: false, connectionAction: '', fullscreenBusy: false, inputBusy: false, inputStatus: '', status: '已断开，点「重新寻找电视」可连接' })
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
  toggleTouchSettings() { this.setData({ showTouchSettings: !this.data.showTouchSettings }) },
  touchPreference(event) {
    const field = event.currentTarget.dataset.preference
    if (!['pointerSpeed', 'scrollSpeed', 'reverseScroll'].includes(field)) return
    this.clearMotion()
    const preferences = normalizePreferences(Object.assign({}, this.data.preferences, { [field]: event.detail.value }))
    this.setData({ preferences })
    if (!savePreferences(wx, preferences)) wx.showToast({ title: '设置本次有效，保存失败，下次需重新调整', icon: 'none' })
  },
  resetTouchSettings() {
    this.clearMotion()
    const preferences = normalizePreferences(DEFAULT_PREFERENCES)
    this.setData({ preferences })
    if (!savePreferences(wx, preferences)) wx.showToast({ title: '已恢复默认，保存失败', icon: 'none' })
  },
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
            this.setData({ 'media.hint': error.message })
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
    this.setData(op === 'setQuality' ? { mediaBusy: true, qualityChoices: [] } : { mediaBusy: true })
    try {
      const reply = await this.client.request(op, Object.assign({}, fields, { mediaId }))
      if (epoch === this.mediaPollEpoch) this.updateMedia(reply.media)
    } catch (error) {
      if (epoch === this.mediaPollEpoch) {
        if (error.code === 'media_changed') {
          this.setData({ media: emptyMedia('正在重新读取视频状态…'), qualityChoices: [] })
        } else {
          this.setData({ 'media.hint': '正在重新读取视频状态…' })
        }
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
    if (this.data.mediaBusy || this.data.media.quality.switching) return
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
    if (!snapshot || snapshot.mediaId !== this.data.media.mediaId || this.data.mediaBusy || this.data.media.quality.switching) {
      this.setData({ 'media.slider': this.data.media.slider })
      return
    }
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
            this.setData({ 'volume.hint': error.message })
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
        this.setData({ 'volume.hint': '正在重新读取盒子音量…' })
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
    if (!drag || drag.epoch !== this.volumePollEpoch || this.data.volumeBusy) {
      this.setData({ 'volume.percent': this.data.volume.percent })
      return
    }
    return this.volumeCommand('setVolume', { percent: event.detail.value })
  },
  volumeCancel() {
    clearTimeout(this.volumeReleaseTimer)
    if (this.volumeDrag) this.setData({ volume: this.volumeDrag.volume })
    this.volumeDrag = null
  },
  muteChange(event) {
    if (!this.data.connected || !this.data.volume.supported || this.data.volumeBusy) {
      this.setData({ 'volume.muted': this.data.volume.muted })
      return
    }
    return this.volumeCommand('setMuted', { muted: event.detail.value })
  },
  inputMode(event) {
    const mode = event.currentTarget.dataset.mode
    if (!['open', 'text'].includes(mode) || this.data.inputBusy) return
    this.inputRevision = (this.inputRevision || 0) + 1
    this.setData({ inputMode: mode, inputStatus: '' })
  },
  clearInput() {
    this.inputRevision = (this.inputRevision || 0) + 1
    this.setData({ [this.data.inputMode === 'text' ? 'pageText' : 'openText']: '', inputStatus: '' })
  },
  async send() {
    if (this.data.inputBusy) return
    if (!this.data.connected) { this.setData({ inputStatus: '请先连接电视，再发送文字' }); return }
    const op = this.data.inputMode === 'text' ? 'text' : 'open'
    const text = this.data[op === 'text' ? 'pageText' : 'openText']
    if (!text.trim()) { this.setData({ inputStatus: op === 'text' ? '请先输入要发送到电视的文字' : '请先输入网址或搜索词' }); return }
    const epoch = this.epoch, revision = this.inputRevision
    this.setData({ inputBusy: true, inputStatus: '正在发送…' })
    try {
      await this.client.request(op, { text })
      if (epoch === this.epoch && revision === this.inputRevision) {
        this.setData({ inputStatus: op === 'text' ? '文字已发送到电视输入框' : '已发送，电视正在打开网址或搜索' })
      }
    } catch (error) {
      if (epoch === this.epoch && revision === this.inputRevision) {
        const message = error.code === 'no_input' ? '未选中输入框：请先在电视上点中网页或浏览器输入框，再点发送' : error.message
        this.setData({ inputStatus: message })
        wx.showToast({ title: message, icon: 'none', duration: 2600 })
      }
    } finally { if (epoch === this.epoch) this.setData({ inputBusy: false }) }
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
    const scale = motionScale(this.data.preferences, op, this.data.navigation)
    this.motion.dx = Math.max(-500, Math.min(500, this.motion.dx + dx * scale))
    this.motion.dy = Math.max(-500, Math.min(500, this.motion.dy + dy * scale))
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
