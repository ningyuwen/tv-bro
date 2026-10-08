package com.phlox.tvwebbrowser.remote

import android.app.Activity
import android.content.Context
import android.view.KeyEvent
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.WeakHashMap
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import com.phlox.tvwebbrowser.R
import com.phlox.tvwebbrowser.widgets.cursor.CursorLayout
import org.json.JSONObject

/** Route native-page input to the visible page instead of the covered WebView. */
object RemotePageController {
    private val gestures = WeakHashMap<Activity, RemoteNavigationGesture>()

    fun execute(activity: Activity, command: RemoteCommand): JSONObject {
        val root = RemoteUiWindows.activeRoot(activity)
        val dialogOpen = root !== activity.window.decorView
        val gesture = gestures.getOrPut(activity) { RemoteNavigationGesture() }
        fun move(dx: Float, dy: Float) {
            val name = gesture.move(dx, dy, root, android.os.SystemClock.uptimeMillis()) ?: return
            val key = when (name) {
                "up" -> KeyEvent.KEYCODE_DPAD_UP
                "down" -> KeyEvent.KEYCODE_DPAD_DOWN
                "left" -> KeyEvent.KEYCODE_DPAD_LEFT
                else -> KeyEvent.KEYCODE_DPAD_RIGHT
            }
            RemoteUiNavigator.key(root, key)
        }
        fun feedback(result: JSONObject = JSONObject()): JSONObject {
            val current = RemoteUiWindows.activeRoot(activity)
            return result.put("ui", JSONObject().put("mode", if (current !== activity.window.decorView) "navigation" else "pointer")
                .put("focus", RemoteUiNavigator.label(current.findFocus())))
        }
        fun pointer() = requireNotNull(activity.findViewById<CursorLayout>(R.id.remoteCursor)) { "not_ready" }
            .apply {
                if (!cursorEnabled) {
                    cursorEnabled = true
                    cursorDrawerDelegate.onSizeChanged(width, height, 0, 0)
                }
            }.cursorDrawerDelegate
        fun key(code: Int) {
            gesture.reset()
            if (code == KeyEvent.KEYCODE_BACK) {
                val insets = ViewCompat.getRootWindowInsets(root)
                if (insets?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                    (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                        .hideSoftInputFromWindow(root.windowToken, 0)
                    return
                }
                root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
                root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
            } else RemoteUiNavigator.key(root, code)
        }
        when (command) {
            is RemoteCommand.Volume -> return feedback(RemoteVolumeController(activity).execute(command))
            is RemoteCommand.Move -> if (dialogOpen) move(command.dx, command.dy) else { gesture.reset(); pointer().remoteMove(command.dx, command.dy) }
            is RemoteCommand.Scroll -> if (dialogOpen) move(-command.dx, -command.dy) else pointer().remoteScroll(command.dx, command.dy)
            is RemoteCommand.Text -> {
                val input = (root.findFocus() ?: activity.currentFocus) as? EditText ?: throw IllegalArgumentException("no_input")
                input.setText(command.text)
                input.setSelection(input.length())
                (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                    .hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
            }
            is RemoteCommand.Action -> when (command.name) {
                "status" -> Unit
                "back" -> key(KeyEvent.KEYCODE_BACK)
                "click" -> if (dialogOpen) key(KeyEvent.KEYCODE_DPAD_CENTER) else { gesture.reset(); pointer().remoteClick() }
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
        return feedback()
    }
}
