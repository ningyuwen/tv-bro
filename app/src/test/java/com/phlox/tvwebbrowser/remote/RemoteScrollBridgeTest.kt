package com.phlox.tvwebbrowser.remote

import android.app.Application
import android.view.MotionEvent
import android.view.View
import com.phlox.tvwebbrowser.webengine.RemoteScrollScript
import com.phlox.tvwebbrowser.widgets.cursor.CursorDrawerDelegate
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE, application = Application::class)
class RemoteScrollBridgeTest {
    @Test fun scrollProtocolAcceptsOldClientsAndCarriesNewGestureIdentity() {
        val json = JSONObject().put("op", "scroll").put("dx", 0).put("dy", 120)
        assertEquals(RemoteCommand.Scroll(0f, 120f), RemoteProtocol.parse(json))
        json.put("gestureId", "3-123456-abc")
        assertEquals(RemoteCommand.Scroll(0f, 120f, "3-123456-abc"), RemoteProtocol.parse(json))
    }

    @Test fun invalidGestureIdsAndCoordinatesNeverReachThePage() {
        for (id in listOf<Any>("", "a".repeat(81), "');alert(1)//", 42, JSONObject.NULL)) {
            val json = JSONObject().put("op", "scroll").put("dx", 0).put("dy", 10).put("gestureId", id)
            assertThrows(IllegalArgumentException::class.java) { RemoteProtocol.parse(json) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            RemoteProtocol.parse(JSONObject().put("op", "scroll").put("dx", 501).put("dy", 0))
        }
    }

    @Test fun domScrollReceivesVisibleCursorCoordinatesWithoutDispatchingAWheelOrNativeListCallback() {
        val app = RuntimeEnvironment.getApplication()
        var wheel = false
        var nativeList = false
        val surface = object : View(app) {
            override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean { wheel = true; return true }
        }
        val cursor = CursorDrawerDelegate(app, surface)
        cursor.cursorPosition.set(160f, 240f)
        cursor.customScrollCallback = object : CursorDrawerDelegate.CustomScrollCallback {
            override fun onScroll(scrollX: Int, scrollY: Int): Boolean { nativeList = true; return true }
        }
        var position: Pair<Float, Float>? = null
        cursor.remoteScroll(0f, 120f) { x, y -> position = x to y }
        assertEquals(160f to 240f, position)
        assertFalse(wheel)
        assertFalse(nativeList)
        cursor.remoteScroll(0f, 120f)
        assertTrue(nativeList)
    }

    @Test fun sharedScrollingAssetIsPackagedAndUsesVoidForJavascriptUriCompatibility() {
        val command = RemoteScrollScript.command(RuntimeEnvironment.getApplication(), 160f, 240f, 0f, 120f, "a-1")
        assertTrue(command.startsWith("void ("))
        assertTrue(command.contains("function limeRemoteScroll("))
        assertTrue(command.matches(Regex("(?s).*\\Q)(160.0,240.0,0.0,120.0,\"a-1\",\\E[0-9]+\\)")))
    }
}
