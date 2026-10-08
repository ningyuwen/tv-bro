package com.phlox.tvwebbrowser.remote

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.os.Bundle
import android.os.Looper
import android.view.KeyEvent
import android.widget.Button
import android.widget.EditText
import com.phlox.tvwebbrowser.AppContext
import com.phlox.tvwebbrowser.Config as BrowserConfig
import com.phlox.tvwebbrowser.R
import com.phlox.tvwebbrowser.widgets.cursor.CursorLayout
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.android.controller.ActivityController
import java.net.Socket
import java.time.Duration
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE, application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class PhoneRemoteSessionTest {
    class Page : Activity() {
        val keys = mutableListOf<Int>()
        var clicks = 0
        override fun onCreate(state: Bundle?) {
            super.onCreate(state)
            val cursor = CursorLayout(this).apply {
                id = R.id.remoteCursor
                cursorEnabled = false
                dpadCursorEnabled = false
            }
            cursor.addView(Button(this).apply { setOnClickListener { clicks++ } },
                android.widget.FrameLayout.LayoutParams(800, 600))
            setContentView(cursor)
            cursor.measure(android.view.View.MeasureSpec.makeMeasureSpec(800, android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec(600, android.view.View.MeasureSpec.EXACTLY))
            cursor.layout(0, 0, 800, 600)
        }
        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.action == KeyEvent.ACTION_UP) keys.add(event.keyCode)
            return true
        }
    }
    private lateinit var session: PhoneRemoteSession
    private val pages = mutableListOf<ActivityController<Page>>()
    private val sockets = mutableListOf<Socket>()
    private val worker = Executors.newSingleThreadExecutor()
    private val token = "a".repeat(64)

    @Before fun setup() {
        val app = RuntimeEnvironment.getApplication()
        AppContext.init(app, BrowserConfig(app.getSharedPreferences("browser", 0)))
        app.getSharedPreferences("phone_remote", 0).edit().clear()
            .putStringSet("tokens", setOf(token)).commit()
        session = PhoneRemoteSession(app)
    }
    @After fun cleanup() {
        session.close()
        sockets.forEach { it.close() }
        pages.forEach { it.pause().stop().destroy() }
        worker.shutdownNow()
    }
    private fun page() = Robolectric.buildActivity(Page::class.java).create().start().resume().visible()
        .also { pages.add(it) }
    private fun socket() = Socket("127.0.0.1", PhoneRemoteServer.PORT).also {
        it.soTimeout = 3000
        sockets.add(it)
    }
    private fun request(socket: Socket, op: String, vararg fields: Pair<String, Any>): JSONObject {
        val future = worker.submit<JSONObject> {
            val json = JSONObject().put("id", 1).put("op", op).put("token", token)
            fields.forEach { (key, value) -> json.put(key, value) }
            socket.getOutputStream().write((json.toString() + "\n").toByteArray())
            JSONObject(socket.getInputStream().bufferedReader().readLine())
        }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(4)
        while (!future.isDone && System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
        return future.get(1, TimeUnit.SECONDS)
    }

    @Test fun historyAndDownloadsTransitionsKeepTheSameTcpConnectionAndRouteInput() {
        val browser = page()
        val connection = socket()
        assertTrue(request(connection, "status").getBoolean("ok"))
        browser.pause()
        // Heartbeat in the pause/resume gap must succeed too.
        assertTrue(request(connection, "status").getBoolean("ok"))
        val history = page()
        browser.stop()
        assertTrue(request(connection, "move", "dx" to 10, "dy" to 20).getBoolean("ok"))
        assertTrue(request(connection, "click").getBoolean("ok"))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, history.get().clicks)
        assertEquals(0, browser.get().clicks)
        assertTrue(request(connection, "scroll", "dx" to 0, "dy" to 120).getBoolean("ok"))
        assertTrue(request(connection, "back").getBoolean("ok"))
        assertEquals(listOf(KeyEvent.KEYCODE_BACK), history.get().keys)
        history.pause().stop().destroy()
        pages.remove(history)
        browser.restart().start().resume()
        assertTrue(request(connection, "status").getBoolean("ok"))
        browser.pause()
        val downloads = page()
        browser.stop()
        assertTrue(request(connection, "down").getBoolean("ok"))
        assertEquals(listOf(KeyEvent.KEYCODE_DPAD_DOWN), downloads.get().keys)
        assertTrue(request(connection, "status").getBoolean("ok"))
    }

    @Test fun videoCommandsOnNativePagesDoNotOperateTheCoveredBrowserOrDisconnect() {
        page()
        val connection = socket()
        assertEquals("no_media", request(connection, "mediaStatus").getString("error"))
        assertEquals("not_ready", request(connection, "toggleFullscreen").getString("error"))
        assertEquals("not_ready", request(connection, "open", "text" to "https://example.com").getString("error"))
        assertTrue(request(connection, "status").getBoolean("ok"))
    }

    @Test fun activityRecreationKeepsTheSocketAndReleasesTheOldPage() {
        val old = page()
        val connection = socket()
        old.pause().stop().destroy()
        pages.remove(old)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400))
        val replacement = page()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400))
        assertTrue(request(connection, "back").getBoolean("ok"))
        assertTrue(old.get().keys.isEmpty())
        assertEquals(listOf(KeyEvent.KEYCODE_BACK), replacement.get().keys)
    }

    @Test fun backgroundRejectsInputThenClosesSocketAndKeepsAuthorizationForReturn() {
        val browser = page()
        val connection = socket()
        browser.pause().stop()
        assertEquals("background", request(connection, "back").getString("error"))
        assertTrue(browser.get().keys.isEmpty())
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(701))
        assertEquals(-1, connection.getInputStream().read())
        browser.restart().start().resume()
        assertTrue(request(socket(), "status").getBoolean("ok"))
    }

    @Test fun coveringAnActivityWithoutStoppingItDoesNotDropTheConnection() {
        val browser = page()
        val connection = socket()
        browser.pause()
        val overlay = page()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
        assertTrue(request(connection, "status").getBoolean("ok"))
        overlay.pause().stop().destroy()
        pages.remove(overlay)
        browser.resume()
        assertTrue(request(connection, "status").getBoolean("ok"))
    }

    @Test fun inAppDialogsKeepTheExistingConnection() {
        val browser = page()
        val connection = socket()
        val dialog = AlertDialog.Builder(browser.get()).setMessage("Settings / bookmarks")
            .setPositiveButton("OK", null).show()
        try {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
            assertTrue(request(connection, "status").getBoolean("ok"))
        } finally { dialog.dismiss() }
        assertTrue(request(connection, "status").getBoolean("ok"))
    }

    @Test fun textInputUsesTheVisibleNativePage() {
        val native = page()
        val input = EditText(native.get())
        native.get().setContentView(input)
        native.visible()
        shadowOf(Looper.getMainLooper()).idle()
        input.requestFocus()
        // Robolectric shadows Activity.getCurrentFocus separately from the view hierarchy.
        shadowOf(native.get()).setCurrentFocus(input)
        assertSame(input, native.get().currentFocus)
        val connection = socket()
        val reply = request(connection, "text", "text" to "青柠输入")
        assertTrue(reply.toString(), reply.getBoolean("ok"))
        assertEquals("青柠输入", input.text.toString())
    }

    @Test fun nativePageDialogUsesNavigationAndRestoresPointerAfterConfirmation() {
        val native = page()
        val connection = socket()
        var confirmed = 0
        val dialog = RemoteUiWindows.alert(native.get()).setMessage("Options")
            .setPositiveButton("Confirm") { _, _ -> confirmed++ }.show()
        try {
            shadowOf(Looper.getMainLooper()).idle()
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).apply { isFocusableInTouchMode = true; requestFocus() }
            assertEquals("navigation", request(connection, "status").getJSONObject("ui").getString("mode"))
            assertTrue(request(connection, "click").getBoolean("ok"))
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(1, confirmed)
            assertEquals(0, native.get().clicks)
            assertEquals("pointer", request(connection, "status").getJSONObject("ui").getString("mode"))
        } finally { dialog.dismiss() }
    }

    @Test fun disabledRemoteIsNotRestartedByNavigation() {
        RuntimeEnvironment.getApplication().getSharedPreferences("phone_remote", 0)
            .edit().putBoolean("enabled", false).commit()
        val browser = page()
        browser.pause()
        page()
        browser.stop()
        assertThrows(java.net.ConnectException::class.java) { socket() }
    }
}
