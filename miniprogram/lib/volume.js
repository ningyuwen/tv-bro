function emptyVolume(hint = '正在读取盒子音量…') {
  return { ready: false, supported: false, percent: 0, muted: false, hint }
}
function volumeView(value) {
  if (!value || typeof value.supported !== 'boolean' || typeof value.muted !== 'boolean' ||
      !Number.isInteger(value.percent) || value.percent < 0 || value.percent > 100) {
    return emptyVolume('暂时无法读取盒子音量')
  }
  return { ready: true, supported: value.supported, percent: value.percent, muted: value.muted,
    hint: value.supported ? '调整盒子的媒体音量' : '此盒子使用固定音量，请用电视或音响遥控器调整' }
}
module.exports = { emptyVolume, volumeView }
