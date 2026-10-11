const DEFAULT_PREFERENCES = Object.freeze({ pointerSpeed: 100, scrollSpeed: 100, reverseScroll: false })
const STORAGE_KEY = 'lime-touch-preferences-v1'

function normalizeSpeed(value) {
  return Number.isInteger(value) && value >= 50 && value <= 200 ? Math.round(value / 25) * 25 : 100
}
function normalizePreferences(value) {
  const preferences = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return { pointerSpeed: normalizeSpeed(preferences.pointerSpeed), scrollSpeed: normalizeSpeed(preferences.scrollSpeed),
    reverseScroll: typeof preferences.reverseScroll === 'boolean' ? preferences.reverseScroll : false }
}
function readPreferences(wxApi) {
  try { return normalizePreferences(wxApi.getStorageSync(STORAGE_KEY)) }
  catch (_) { return normalizePreferences(null) }
}
function savePreferences(wxApi, value) {
  try {
    wxApi.setStorageSync(STORAGE_KEY, normalizePreferences(value))
    return true
  } catch (_) { return false }
}
function motionScale(preferences, op, navigation = false) {
  if (op !== 'move' && op !== 'scroll') return 1
  if (navigation) return op === 'scroll' ? -2 : 2
  const value = normalizePreferences(preferences)
  return op === 'scroll' ? (value.reverseScroll ? 2 : -2) * value.scrollSpeed / 100 : 2 * value.pointerSpeed / 100
}
module.exports = { DEFAULT_PREFERENCES, normalizePreferences, readPreferences, savePreferences, motionScale }
