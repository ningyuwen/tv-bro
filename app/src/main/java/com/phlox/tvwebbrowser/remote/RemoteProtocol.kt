package com.phlox.tvwebbrowser.remote

import org.json.JSONObject

/** All fields are validated before they reach the Android main thread. */
sealed class RemoteCommand {
    data class Move(val dx: Float, val dy: Float) : RemoteCommand()
    data class Scroll(val dx: Float, val dy: Float) : RemoteCommand()
    data class Text(val text: String) : RemoteCommand()
    data class Open(val text: String) : RemoteCommand()
    data class Action(val name: String) : RemoteCommand()
}

object RemoteProtocol {
    const val MAX_FRAME_BYTES = 16384
    private val actions = setOf("click", "back", "forward", "refresh", "home", "menu", "playPause",
        "nextTab", "newTab", "closeTab", "up", "down", "left", "right", "ok", "status")

    fun parse(json: JSONObject): RemoteCommand {
        fun text(): String {
            val value = json.get("text")
            require(value is String && value.length <= 4096) { "invalid_text" }
            return value
        }
        fun number(key: String): Float {
            val value = json.get(key)
            require(value is Number) { "invalid_coordinate" }
            val n = value.toDouble()
            require(n.isFinite() && n in -500.0..500.0) { "invalid_coordinate" }
            return n.toFloat()
        }
        return when (val op = json.getString("op")) {
            "move" -> RemoteCommand.Move(number("dx"), number("dy"))
            "scroll" -> RemoteCommand.Scroll(number("dx"), number("dy"))
            "text" -> RemoteCommand.Text(text())
            "open" -> {
                val value = text().trim()
                require(value.isNotEmpty()) { "empty_text" }
                // Search terms and HTTP(S) addresses only; never intent:, file: or javascript:.
                require(!Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:").containsMatchIn(value) ||
                    value.startsWith("https://", true) || value.startsWith("http://", true)) { "invalid_url" }
                RemoteCommand.Open(value)
            }
            in actions -> RemoteCommand.Action(op)
            else -> throw IllegalArgumentException("unknown_command")
        }
    }
}
