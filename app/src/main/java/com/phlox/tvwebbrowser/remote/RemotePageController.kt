package com.phlox.tvwebbrowser.remote

import android.app.Activity
import android.content.Context
import android.view.KeyEvent
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import com.phlox.tvwebbrowser.R
import com.phlox.tvwebbrowser.widgets.cursor.CursorLayout
import org.json.JSONObject

/** Route native-page input to the visible page instead of the covered WebView. */
object RemotePageController {
    fun execute(activity: Activity, command: RemoteCommand): JSONObject {
        fun pointer() = requireNotNull(activity.findViewById<CursorLayout>(R.id.remoteCursor)) { "not_ready" }
            .apply {
                if (!cursorEnabled) {
                    cursorEnabled = true
                    cursorDrawerDelegate.onSizeChanged(width, height, 0, 0)
                }
            }.cursorDrawerDelegate
        fun key(code: Int) {
            activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
            activity.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
        }
        when (command) {
            is RemoteCommand.Volume -> return RemoteVolumeController(activity).execute(command)
            is RemoteCommand.Move -> pointer().remoteMove(command.dx, command.dy)
            is RemoteCommand.Scroll -> pointer().remoteScroll(command.dx, command.dy)
            is RemoteCommand.Text -> {
                val input = activity.currentFocus as? EditText ?: throw IllegalArgumentException("no_input")
                input.setText(command.text)
                input.setSelection(input.length())
                (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                    .hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
            }
            is RemoteCommand.Action -> when (command.name) {
                "status" -> Unit
                "back" -> key(KeyEvent.KEYCODE_BACK)
                "click" -> pointer().remoteClick()
                "up" -> key(KeyEvent.KEYCODE_DPAD_UP)
                "down" -> key(KeyEvent.KEYCODE_DPAD_DOWN)
                "left" -> key(KeyEvent.KEYCODE_DPAD_LEFT)
                "right" -> key(KeyEvent.KEYCODE_DPAD_RIGHT)
                "ok" -> key(KeyEvent.KEYCODE_DPAD_CENTER)
                else -> throw IllegalArgumentException("not_ready")
            }
            is RemoteCommand.Media -> throw IllegalArgumentException("no_media")
            is RemoteCommand.Open -> throw IllegalArgumentException("not_ready")
        }
        return JSONObject()
    }
}
