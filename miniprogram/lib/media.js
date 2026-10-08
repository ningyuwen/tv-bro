function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const value = Math.floor(seconds), hours = Math.floor(value / 3600)
  const minutes = Math.floor(value / 60) % 60, rest = String(value % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
function emptyMedia(hint = '正在读取视频状态…') {
  return { available: false, canSeek: false, paused: true, mediaId: '', position: 0,
    duration: null, seekStart: 0, seekEnd: 0, slider: 0, currentLabel: '--:--', durationLabel: '--:--', hint,
    quality: qualityView(null) }
}
function qualityView(value) {
  const options = value && Array.isArray(value.options) && value.options.length <= 33 ? value.options.filter(option =>
    option && typeof option.id === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(option.id) &&
    typeof option.label === 'string' && option.label.length > 0 && option.label.length <= 60
  ).map(option => ({ id: option.id, label: option.label })) : []
  const supported = !!value && value.supported === true && options.length >= 2 &&
    new Set(options.map(option => option.id)).size === options.length
  const selected = supported && options.find(option => option.id === value.selectedId)
  const currentHeight = value && Number.isInteger(value.currentHeight) && value.currentHeight > 0 && value.currentHeight <= 16384
    ? value.currentHeight : 0
  const currentLabel = currentHeight ? currentHeight + 'P' : '尚未读取'
  return { supported, options: supported ? options : [], selectedId: selected ? selected.id : '',
    selectedLabel: selected ? selected.label : '尚未选择', currentLabel,
    switching: supported && value.switching === true,
    hint: value && value.failed ? '切换失败，请重新选择或在电视网页中操作' :
      value && value.switching ? '正在切换，加载后恢复播放进度…' :
      supported ? '由网页播放器切换，已有缓冲播放完后实际画质才可能更新' :
      value && value.reason === 'engine_unsupported' ? '此内核暂不支持，请在电视设置中切换为 WebView' : '暂不支持此网页播放器切换清晰度' }
}
function mediaView(value) {
  if (!value || value.available !== true) return emptyMedia('当前页面未检测到可控制的视频')
  if (typeof value.mediaId !== 'string' || !value.mediaId || !Number.isFinite(value.position) || value.position < 0) {
    return emptyMedia('视频状态暂不可用')
  }
  const duration = Number.isFinite(value.duration) && value.duration > 0 ? value.duration : null
  const start = value.seekStart, end = value.seekEnd
  const canSeek = value.canSeek === true && duration !== null && Number.isFinite(start) &&
    Number.isFinite(end) && start >= 0 && end > start && end <= duration
  return { available: true, mediaId: value.mediaId, paused: value.paused !== false,
    position: value.position, duration, canSeek, seekStart: canSeek ? start : 0, seekEnd: canSeek ? end : 0,
    slider: canSeek ? Math.round(Math.max(0, Math.min(1, (value.position - start) / (end - start))) * 1000) : 0,
    currentLabel: formatTime(value.position), durationLabel: formatTime(duration),
    hint: canSeek ? '拖动进度条，松手后跳转' : '视频加载中、直播或播放器暂不支持调整进度',
    quality: qualityView(value.quality) }
}
function sliderTarget(value, media) {
  const fraction = Math.max(0, Math.min(1000, Number(value))) / 1000
  return media.seekStart + fraction * (media.seekEnd - media.seekStart)
}
module.exports = { formatTime, emptyMedia, mediaView, sliderTarget, qualityView }
