package com.phlox.tvwebbrowser.remote

import android.app.Application
import android.content.Context
import android.media.AudioManager
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE, application = Application::class)
class RemoteVolumeControllerTest {
    private lateinit var audio: AudioManager
    private lateinit var controller: RemoteVolumeController

    @Before fun setup() {
        val context = RuntimeEnvironment.getApplication()
        audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        shadowOf(audio).setStreamMaxVolume(15)
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, 6, 0)
        controller = RemoteVolumeController(context)
    }

    @Test fun statusReadsActualMediaVolumeWithoutChangingOtherStreams() {
        audio.setStreamVolume(AudioManager.STREAM_ALARM, 4, 0)
        val state = controller.execute(RemoteCommand.Volume("volumeStatus")).getJSONObject("volume")
        assertTrue(state.getBoolean("supported"))
        assertEquals(40, state.getInt("percent"))
        assertFalse(state.getBoolean("muted"))
        controller.execute(RemoteCommand.Volume("setVolume", percent = 80))
        assertEquals(12, audio.getStreamVolume(AudioManager.STREAM_MUSIC))
        assertEquals(4, audio.getStreamVolume(AudioManager.STREAM_ALARM))
    }

    @Test fun percentagesRoundToHardwareStepsAndReturnActualState() {
        for ((percent, level, actual) in listOf(Triple(0, 0, 0), Triple(50, 8, 53), Triple(100, 15, 100))) {
            val state = controller.execute(RemoteCommand.Volume("setVolume", percent = percent)).getJSONObject("volume")
            assertEquals(level, audio.getStreamVolume(AudioManager.STREAM_MUSIC))
            assertEquals(actual, state.getInt("percent"))
        }
    }

    @Test fun muteAndUnmuteSetExplicitStateAndTrackExternalChanges() {
        assertTrue(controller.execute(RemoteCommand.Volume("setMuted", muted = true)).getJSONObject("volume").getBoolean("muted"))
        assertTrue(controller.execute(RemoteCommand.Volume("setMuted", muted = true)).getJSONObject("volume").getBoolean("muted"))
        assertFalse(controller.execute(RemoteCommand.Volume("setMuted", muted = false)).getJSONObject("volume").getBoolean("muted"))
        shadowOf(audio).setIsStreamMute(AudioManager.STREAM_MUSIC, true)
        assertTrue(controller.execute(RemoteCommand.Volume("volumeStatus")).getJSONObject("volume").getBoolean("muted"))
    }

    @Test fun deviceWithoutAdjustableRangeDisablesControls() {
        shadowOf(audio).setStreamMaxVolume(0)
        val state = controller.execute(RemoteCommand.Volume("volumeStatus")).getJSONObject("volume")
        assertFalse(state.getBoolean("supported"))
        val error = assertThrows(IllegalArgumentException::class.java) {
            controller.execute(RemoteCommand.Volume("setVolume", percent = 50))
        }
        assertEquals("volume_unsupported", error.message)
    }
}
