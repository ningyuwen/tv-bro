package com.phlox.tvwebbrowser.webengine

import android.app.Application
import android.content.Context
import android.os.Bundle
import com.phlox.tvwebbrowser.AppContext
import com.phlox.tvwebbrowser.Config as BrowserConfig
import com.phlox.tvwebbrowser.model.WebTabState
import com.phlox.tvwebbrowser.utils.Utils
import com.phlox.tvwebbrowser.webengine.webview.WebViewWebEngine
import com.phlox.tvwebbrowser.widgets.cursor.CursorLayout
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.lang.reflect.Proxy

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE, application = Application::class)
class WebViewSessionMigrationTest {
    private lateinit var app: Application
    private lateinit var statesDir: File
    private val restored = mutableListOf<Bundle>()

    @Before fun setup() {
        app = RuntimeEnvironment.getApplication()
        val prefs = app.getSharedPreferences("session-migration", Context.MODE_PRIVATE)
        prefs.edit().clear().putString("web_engine", "GeckoView").commit()
        AppContext.init(app, BrowserConfig(prefs))
        statesDir = File(app.filesDir, WebTabState.TAB_WVSTATES_DIR).apply { mkdirs() }
        val engine = Proxy.newProxyInstance(WebEngine::class.java.classLoader, arrayOf(WebEngine::class.java)) { _, method, args ->
            when (method.name) {
                "restoreState" -> { restored.add(args!![0] as Bundle); null }
                "stateFromBytes" -> Utils.bytesToBundle(args!![0] as ByteArray)
                else -> error("Unexpected engine call: ${method.name}")
            }
        } as WebEngine
        WebEngineFactory.registerProvider(object : WebEngineProviderCallback {
            override suspend fun initialize(context: Context, webViewContainer: CursorLayout) = Unit
            override fun createWebEngine(tab: WebTabState) = engine
            override suspend fun clearCache(ctx: Context) = Unit
            override fun onThemeSettingUpdated(value: BrowserConfig.Theme) = Unit
            override fun getWebEngineVersionString() = "test"
        })
    }

    @Test fun legacyEnginePreferenceCannotSelectRemovedEngine() {
        WebViewWebEngine.registerProvider()
        val engine = WebEngineFactory.createWebEngine(WebTabState(url = "https://example.org/"))
        assertTrue(engine is WebViewWebEngine)
        assertEquals("WebView", engine.getWebEngineName())
    }

    @Test fun legacySessionReloadsOriginalUrlAndPreservesTabMetadata() {
        val file = File(statesDir, "old-session").apply { writeText("old non-Bundle session") }
        val tab = WebTabState(id = 42, url = "https://example.org/page", title = "Saved page",
            selected = true, position = 3, wvStateFileName = "gecko:old-session")
        assertFalse(tab.restoreWebView())
        assertNull(tab.wvStateFileName)
        assertFalse(file.exists())
        assertEquals(42L, tab.id)
        assertEquals("https://example.org/page", tab.url)
        assertEquals("Saved page", tab.title)
        assertTrue(tab.selected)
        assertEquals(3, tab.position)
        assertTrue(restored.isEmpty())
    }

    @Test fun firstWebViewSaveAfterUpgradeKeepsNewBundleAndReplacesOldCache() {
        val oldFile = File(statesDir, "old-save").apply { writeText("legacy session") }
        val tab = WebTabState(url = "https://example.org/", wvStateFileName = "gecko:old-save")
        tab.savedState = Bundle().apply { putString("page", "new WebView state") }
        tab.saveWebViewStateToFile()
        assertFalse(oldFile.exists())
        val name = requireNotNull(tab.wvStateFileName)
        assertFalse(name.startsWith("gecko:"))
        tab.savedState = null
        assertTrue(tab.restoreWebView())
        assertEquals("new WebView state", restored.single().getString("page"))
    }

    @Test fun existingWebViewSessionStillRestores() {
        val bundle = Bundle().apply { putString("history", "WebView back-forward state") }
        File(statesDir, "current-session").writeBytes(requireNotNull(Utils.bundleToBytes(bundle)))
        val tab = WebTabState(url = "https://example.org/", wvStateFileName = "current-session")
        assertTrue(tab.restoreWebView())
        assertEquals("current-session", tab.wvStateFileName)
        assertEquals("WebView back-forward state", restored.single().getString("history"))
    }

    @Test fun missingLegacyPrivateSessionKeepsPrivateTabAndUrl() {
        val tab = WebTabState(url = "https://example.org/private", incognito = true,
            selected = true, wvStateFileName = "gecko:missing")
        assertFalse(tab.restoreWebView())
        assertNull(tab.wvStateFileName)
        assertTrue(tab.incognito)
        assertTrue(tab.selected)
        assertEquals("https://example.org/private", tab.url)
    }
}
