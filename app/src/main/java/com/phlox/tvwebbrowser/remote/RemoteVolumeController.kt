package com.phlox.tvwebbrowser.remote

import android.content.Context
import android.media.AudioManager
import android.os.Build
import org.json.JSONObject
import kotlin.math.roundToInt

/** Controls the box's media stream, independently of the current page and web engine. */
class RemoteVolumeController(context: Context) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun execute(command: RemoteCommand.Volume): JSONObject {
        val stream = AudioManager.STREAM_MUSIC
        val min = if (Build.VERSION.SDK_INT >= 28) audio.getStreamMinVolume(stream) else 0
        val max = audio.getStreamMaxVolume(stream)
        val supported = !audio.isVolumeFixed && max > min
        if (command.action != "volumeStatus") {
            require(supported) { "volume_unsupported" }
            try {
                when (command.action) {
                    "setVolume" -> {
                        val percent = requireNotNull(command.percent)
                        val level = min + ((max - min) * percent / 100.0).roundToInt()
                        audio.setStreamVolume(stream, level.coerceIn(min, max), AudioManager.FLAG_SHOW_UI)
                    }
                    "setMuted" -> audio.adjustStreamVolume(stream,
                        if (command.muted == true) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE,
                        AudioManager.FLAG_SHOW_UI)
                    else -> throw IllegalArgumentException("unknown_command")
                }
            } catch (_: SecurityException) {
                throw IllegalArgumentException("volume_denied")
            }
        }
        val level = audio.getStreamVolume(stream).coerceIn(min, max)
        return JSONObject().put("volume", JSONObject()
            .put("supported", supported)
            .put("percent", if (max > min) ((level - min) * 100.0 / (max - min)).roundToInt() else 100)
            .put("muted", audio.isStreamMute(stream)))
    }
}
