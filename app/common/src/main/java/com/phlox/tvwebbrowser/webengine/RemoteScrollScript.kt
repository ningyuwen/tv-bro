package com.phlox.tvwebbrowser.webengine

import android.content.Context
import org.json.JSONObject

/** WebView scrolling bridge; only native-generated, validated coordinates enter the script. */
object RemoteScrollScript {
    private var script: String? = null

    fun command(context: Context, x: Float, y: Float, dx: Float, dy: Float, gestureId: String?): String {
        val source = script ?: context.assets.open("extensions/generic/remote_scroll.js").bufferedReader().use { it.readText() }
            .also { script = it }
        val deadline = System.currentTimeMillis() + 1500
        return "void ($source)($x,$y,$dx,$dy,${gestureId?.let(JSONObject::quote) ?: "null"},$deadline)"
    }
}
