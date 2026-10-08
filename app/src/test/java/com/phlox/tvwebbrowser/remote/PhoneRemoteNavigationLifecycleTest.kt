package com.phlox.tvwebbrowser.remote

import android.app.Application
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE, application = Application::class)
class PhoneRemoteNavigationLifecycleTest {
    class Screen : AppCompatActivity() {
        override fun onCreate(state: Bundle?) {
            setTheme(androidx.appcompat.R.style.Theme_AppCompat)
            super.onCreate(state)
        }
    }

    @Test fun changingBrowserScreensKeepsConnectionButLeavingAppClosesServer() {
        val main = Robolectric.buildActivity(Screen::class.java).setup().visible()
        val remote = PhoneRemoteController(main.get()) { _, complete -> complete(Result.success(org.json.JSONObject())) }
        try {
            remote.startIfEnabled()
            val server = ReflectionHelpers.getField<PhoneRemoteServer>(remote, "server")
            assertTrue(server.isRunning)
            main.pause()
            val history = Robolectric.buildActivity(Screen::class.java).setup().visible()
            try {
                main.stop()
                assertSame(history.get(), remote.foregroundActivity)
                assertTrue(server.isRunning)
                history.pause().stop()
                assertFalse(server.isRunning)
                assertNull(remote.foregroundActivity)
            } finally { history.destroy() }
            main.start().resume().visible()
            remote.startIfEnabled()
            assertTrue(ReflectionHelpers.getField<PhoneRemoteServer>(remote, "server").isRunning)
            assertSame(main.get(), remote.foregroundActivity)
        } finally {
            remote.close()
            main.pause().stop().destroy()
        }
    }
}
