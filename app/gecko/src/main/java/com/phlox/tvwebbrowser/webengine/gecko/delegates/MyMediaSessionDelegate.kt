package com.phlox.tvwebbrowser.webengine.gecko.delegates

import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.MediaSession
import android.os.SystemClock
import org.json.JSONObject

class MyMediaSessionDelegate: MediaSession.Delegate {
    var mediaSession: MediaSession? = null
    var paused = false
    private var mediaId = java.util.UUID.randomUUID().toString()
    private var position = 0.0
    private var duration = Double.NaN
    private var rate = 1.0
    private var updatedAt = SystemClock.elapsedRealtime()
    private var features = 0L

    fun reset() {
        mediaSession = null
        duration = Double.NaN
        position = 0.0
        features = 0L
        rate = 1.0
        paused = true
        updatedAt = SystemClock.elapsedRealtime()
        mediaId = java.util.UUID.randomUUID().toString()
    }

    private fun currentPosition(): Double {
        val elapsed = if (paused) 0.0 else (SystemClock.elapsedRealtime() - updatedAt) / 1000.0 * rate
        val current = (position + elapsed).coerceAtLeast(0.0)
        return if (duration.isFinite() && duration > 0) current.coerceAtMost(duration) else current
    }

    fun control(action: String, seconds: Double?, expectedId: String?): JSONObject {
        val media = mediaSession ?: return if (action == "mediaStatus") JSONObject().put("available", false)
            else throw IllegalArgumentException("no_media")
        require(action == "mediaStatus" || expectedId == mediaId) { "media_changed" }
        val canSeek = duration.isFinite() && duration > 0 && (features and MediaSession.Feature.SEEK_TO) != 0L
        when (action) {
            "seekBy", "seekTo" -> {
                require(canSeek) { "media_not_seekable" }
                val target = (if (action == "seekBy") currentPosition() + requireNotNull(seconds) else requireNotNull(seconds))
                    .coerceIn(0.0, duration)
                media.seekTo(target, false)
                position = target
                updatedAt = SystemClock.elapsedRealtime()
            }
            "mediaToggle" -> if (paused) media.play() else media.pause()
            "mediaStatus" -> Unit
            else -> throw IllegalArgumentException("media_unsupported")
        }
        return JSONObject().put("available", true).put("mediaId", mediaId).put("paused", paused)
            .put("position", currentPosition()).put("duration", if (duration.isFinite() && duration > 0) duration else JSONObject.NULL)
            .put("canSeek", canSeek).put("seekStart", 0).put("seekEnd", if (canSeek) duration else 0)
    }
    override fun onActivated(session: GeckoSession, mediaSession: MediaSession) {
        super.onActivated(session, mediaSession)
        reset()
        this.mediaSession = mediaSession
        this.paused = false
        updatedAt = SystemClock.elapsedRealtime()
    }

    override fun onDeactivated(session: GeckoSession, mediaSession: MediaSession) {
        super.onDeactivated(session, mediaSession)
        reset()
    }

    override fun onMetadata(
        session: GeckoSession,
        mediaSession: MediaSession,
        meta: MediaSession.Metadata
    ) {
        super.onMetadata(session, mediaSession, meta)
        mediaId = java.util.UUID.randomUUID().toString()
    }

    override fun onFeatures(session: GeckoSession, mediaSession: MediaSession, features: Long) {
        super.onFeatures(session, mediaSession, features)
        this.features = features
    }

    override fun onPlay(session: GeckoSession, mediaSession: MediaSession) {
        super.onPlay(session, mediaSession)
        position = currentPosition()
        updatedAt = SystemClock.elapsedRealtime()
        paused = false
    }

    override fun onPause(session: GeckoSession, mediaSession: MediaSession) {
        super.onPause(session, mediaSession)
        position = currentPosition()
        updatedAt = SystemClock.elapsedRealtime()
        paused = true
    }

    override fun onStop(session: GeckoSession, mediaSession: MediaSession) {
        super.onStop(session, mediaSession)
        position = 0.0
        updatedAt = SystemClock.elapsedRealtime()
        paused = true
    }

    override fun onPositionState(
        session: GeckoSession,
        mediaSession: MediaSession,
        state: MediaSession.PositionState
    ) {
        super.onPositionState(session, mediaSession, state)
        duration = state.duration
        position = if (state.position.isFinite()) state.position.coerceAtLeast(0.0) else 0.0
        rate = if (state.playbackRate.isFinite()) state.playbackRate else 1.0
        updatedAt = SystemClock.elapsedRealtime()
    }

    override fun onFullscreen(
        session: GeckoSession,
        mediaSession: MediaSession,
        enabled: Boolean,
        meta: MediaSession.ElementMetadata?
    ) {
        super.onFullscreen(session, mediaSession, enabled, meta)
    }
}
