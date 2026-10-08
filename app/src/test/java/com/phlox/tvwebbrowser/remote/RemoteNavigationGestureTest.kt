package com.phlox.tvwebbrowser.remote

import org.junit.Assert.*
import org.junit.Test

class RemoteNavigationGestureTest {
    @Test fun smallMovementsAccumulateAndDominantAxisChoosesOneDirection() {
        val gesture = RemoteNavigationGesture()
        val menu = Any()
        assertNull(gesture.move(20f, 4f, menu, 0))
        assertNull(gesture.move(20f, 4f, menu, 32))
        assertEquals("right", gesture.move(20f, 4f, menu, 64))
        assertEquals("up", gesture.move(4f, -60f, menu, 200))
    }

    @Test fun continuousDragIsRateLimitedAndDoesNotBurstAfterPausing() {
        val gesture = RemoteNavigationGesture()
        val menu = Any()
        assertEquals("down", gesture.move(0f, 500f, menu, 0))
        assertNull(gesture.move(0f, 500f, menu, 32))
        assertEquals("down", gesture.move(0f, 10f, menu, 128))
        assertNull(gesture.move(0f, 5f, menu, 500))
    }

    @Test fun changingWindowsOrConfirmingDiscardsOldDrag() {
        val gesture = RemoteNavigationGesture()
        assertNull(gesture.move(50f, 0f, Any(), 0))
        val dialog = Any()
        assertNull(gesture.move(10f, 0f, dialog, 32))
        assertEquals("left", gesture.move(-70f, 0f, dialog, 64))
        gesture.reset()
        assertNull(gesture.move(20f, 0f, dialog, 100))
    }
}
