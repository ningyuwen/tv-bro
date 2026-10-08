package com.phlox.tvwebbrowser.remote

import org.json.JSONObject

/** All fields are validated before they reach the Android main thread. */
sealed class RemoteCommand {
    data class Move(val dx: Float, val dy: Float) : RemoteCommand()
    data class Scroll(val dx: Float, val dy: Float) : RemoteCommand()
    data class Text(val text: String) : RemoteCommand()
    data class Open(val text: String) : RemoteCommand()
    data class Action(val name: String) : RemoteCommand()
    data class Media(val action: String, val seconds: Double? = null, val mediaId: String? = null,
        val qualityId: String? = null) : RemoteCommand()
    data class Volume(val action: String, val percent: Int? = null, val muted: Boolean? = null) : RemoteCommand()
}

object RemoteProtocol {
    const val MAX_FRAME_BYTES = 16384
    private val actions = setOf("click", "back", "forward", "refresh", "home", "menu", "playPause",
        "nextTab", "newTab", "closeTab", "toggleFullscreen", "up", "down", "left", "right", "ok", "status")

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
            "volumeStatus" -> RemoteCommand.Volume(op)
            "setVolume" -> {
                val value = json.opt("percent")
                require(value is Number && value.toDouble().isFinite() &&
                    value.toDouble() in 0.0..100.0 && value.toDouble() == value.toInt().toDouble()) { "invalid_volume" }
                RemoteCommand.Volume(op, percent = value.toInt())
            }
            "setMuted" -> {
                val value = json.opt("muted")
                require(value is Boolean) { "invalid_volume" }
                RemoteCommand.Volume(op, muted = value)
            }
            "mediaStatus" -> RemoteCommand.Media(op)
            "setQuality" -> {
                val mediaId = json.opt("mediaId")
                require(mediaId is String && mediaId.length in 1..128) { "invalid_media" }
                val qualityId = json.opt("qualityId")
                require(qualityId is String && qualityId.length in 1..128 &&
                    qualityId.matches(Regex("[a-zA-Z0-9-]+"))) { "invalid_quality" }
                RemoteCommand.Media(op, mediaId = mediaId, qualityId = qualityId)
            }
            "seekBy", "seekTo", "mediaToggle" -> {
                val mediaId = json.opt("mediaId")
                require(mediaId is String && mediaId.length in 1..128) { "invalid_media" }
                val seconds = if (op == "mediaToggle") null else {
                    val value = json.opt("seconds")
                    require(value is Number) { "invalid_seek" }
                    value.toDouble().also {
                        require(it.isFinite() && if (op == "seekBy") it in -600.0..600.0 else it in 0.0..31536000.0) { "invalid_seek" }
                    }
                }
                RemoteCommand.Media(op, seconds, mediaId)
            }
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
