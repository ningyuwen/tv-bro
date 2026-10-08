package com.phlox.tvwebbrowser.webengine

import android.content.Context
import androidx.annotation.UiThread
import com.phlox.tvwebbrowser.Config
import com.phlox.tvwebbrowser.model.WebTabState
import com.phlox.tvwebbrowser.widgets.cursor.CursorLayout

interface WebEngineProviderCallback {
    suspend fun initialize(context: Context, webViewContainer: CursorLayout)
    fun createWebEngine(tab: WebTabState): WebEngine
    suspend fun clearCache(ctx: Context)
    fun onThemeSettingUpdated(value: Config.Theme)
    fun getWebEngineVersionString(): String
}

/** The system WebView is the only rendering engine. Legacy engine preferences are ignored. */
object WebEngineFactory {
    private lateinit var provider: WebEngineProviderCallback

    fun registerProvider(provider: WebEngineProviderCallback) {
        this.provider = provider
    }

    @UiThread
    suspend fun initialize(context: Context, webViewContainer: CursorLayout) {
        provider.initialize(context, webViewContainer)
    }

    fun createWebEngine(tab: WebTabState): WebEngine = provider.createWebEngine(tab)

    suspend fun clearCache(ctx: Context) = provider.clearCache(ctx)

    fun onThemeSettingUpdated(value: Config.Theme) = provider.onThemeSettingUpdated(value)

    fun getWebEngineVersionString(): String = provider.getWebEngineVersionString()
}
