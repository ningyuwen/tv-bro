// Function expression so both engines can execute the same self-contained implementation.
function limeRemoteScroll(nativeX, nativeY, nativeDx, nativeDy, gestureId, deadline) {
  'use strict'
  if (Number.isFinite(deadline) && Date.now() > deadline) return false
  if (![nativeX, nativeY, nativeDx, nativeDy].every(Number.isFinite)) return false
  const scale = (window.devicePixelRatio || 1) * ((window.visualViewport && window.visualViewport.scale) || 1)
  const axis = Math.abs(nativeDx) > Math.abs(nativeDy) ? 'x' : 'y'
  const delta = (axis === 'x' ? nativeDx : nativeDy) / scale
  if (!delta) return true
  let state = window.__limeRemoteScrollV1
  if (!gestureId || !state || state.id !== gestureId) {
    let root = document, x = nativeX / scale, y = nativeY / scale, element = null
    // Descend into open shadow roots and same-origin frames under the visible cursor.
    for (let depth = 0; depth < 32; depth++) {
      const hit = root.elementFromPoint(x, y)
      if (!hit || hit === element) break
      element = hit
      if (hit.shadowRoot && hit.shadowRoot.elementFromPoint) {
        root = hit.shadowRoot
        continue
      }
      if (hit.tagName === 'IFRAME' || hit.tagName === 'FRAME') {
        try {
          const child = hit.contentDocument
          if (child && child.elementFromPoint) {
            const rect = hit.getBoundingClientRect()
            const sx = rect.width / hit.offsetWidth || 1, sy = rect.height / hit.offsetHeight || 1
            x = (x - rect.left) / sx - hit.clientLeft
            y = (y - rect.top) / sy - hit.clientTop
            root = child
            continue
          }
        } catch (_) { /* Cross-origin frames remain opaque. Search their ancestors. */ }
      }
      break
    }
    let target = null
    for (let depth = 0; element && depth < 128; depth++) {
      const doc = element.ownerDocument
      const style = doc.defaultView.getComputedStyle(element)
      let overflow = axis === 'x' ? style.overflowX : style.overflowY
      const extent = axis === 'x' ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight
      const isRoot = element === doc.scrollingElement
      if (isRoot && overflow === 'visible' && doc.body) {
        const bodyStyle = doc.defaultView.getComputedStyle(doc.body)
        overflow = axis === 'x' ? bodyStyle.overflowX : bodyStyle.overflowY
      }
      // A horizontal-only carousel is skipped for vertical gestures. Hidden modal backgrounds
      // and overflow:clip are deliberately excluded, including the document scrolling element.
      if (extent > 1 && (/^(auto|scroll|overlay)$/.test(overflow) || isRoot && overflow !== 'hidden' && overflow !== 'clip')) {
        target = element
        break
      }
      if (element.parentElement) element = element.parentElement
      else {
        const host = element.getRootNode && element.getRootNode().host
        if (host) element = host
        else {
          try { element = doc.defaultView.frameElement } catch (_) { element = null }
        }
      }
    }
    state = { id: gestureId, axis, target, left: target ? target.scrollLeft : 0, top: target ? target.scrollTop : 0 }
    // Pin the target as well as the axis until the next gesture; boundaries never switch axes.
    window.__limeRemoteScrollV1 = state
  }
  if (state.axis !== axis || !state.target || !state.target.isConnected) return true
  const target = state.target
  if (axis === 'x') {
    const max = Math.max(0, target.scrollWidth - target.clientWidth)
    const rtl = target.ownerDocument.defaultView.getComputedStyle(target).direction === 'rtl'
    state.left = Math.max(rtl ? -max : 0, Math.min(rtl ? 0 : max, state.left + delta))
  } else state.top = Math.max(0, Math.min(Math.max(0, target.scrollHeight - target.clientHeight), state.top + delta))
  // Keep the intended offset across packets, even when CSS scroll-snap rounds the actual offset.
  // Direct scrolling avoids wheel handlers that turn a vertical gesture into carousel movement.
  target.scrollTo({ left: axis === 'x' ? state.left : target.scrollLeft,
    top: axis === 'y' ? state.top : target.scrollTop, behavior: 'instant' })
  return true
}
