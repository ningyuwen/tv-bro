package com.phlox.tvwebbrowser.remote

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.ArrayAdapter
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35], manifest = Config.NONE, application = Application::class)
class RemoteUiNavigatorTest {
    class Screen : Activity() {
        lateinit var buttons: List<Button>
        override fun onCreate(state: Bundle?) {
            super.onCreate(state)
            val row = LinearLayout(this)
            buttons = (0..6).map { index ->
                Button(this).apply {
                    id = View.generateViewId()
                    text = "Button $index"
                    row.addView(this, LinearLayout.LayoutParams(100, 80))
                }
            }
            buttons.forEachIndexed { index, button ->
                button.nextFocusRightId = buttons[minOf(index + 1, 6)].id
                button.nextFocusLeftId = buttons[maxOf(index - 1, 0)].id
            }
            setContentView(row)
            row.measure(View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(500, View.MeasureSpec.EXACTLY))
            row.layout(0, 0, 1000, 500)
        }
    }

    @Test fun syntheticDirectionsReachAllSixButtonsAndConfirmOnlySelectedOne() {
        val controller = Robolectric.buildActivity(Screen::class.java).setup().visible()
        val activity = controller.get()
        val root = activity.window.decorView
        activity.buttons.first().apply { isFocusableInTouchMode = true; requestFocus() }
        repeat(6) { index ->
            RemoteUiNavigator.key(root, KeyEvent.KEYCODE_DPAD_RIGHT)
            assertSame(activity.buttons[index + 1], root.findFocus())
        }
        var clicks = 0
        activity.buttons.last().setOnClickListener { clicks++ }
        RemoteUiNavigator.key(root, KeyEvent.KEYCODE_DPAD_CENTER)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, clicks)
        RemoteUiNavigator.key(root, KeyEvent.KEYCODE_DPAD_LEFT)
        assertSame(activity.buttons[5], root.findFocus())
        controller.pause().stop().destroy()
    }

    @Test fun nestedDialogsReceiveFocusAndBackWithoutTouchingUnderlyingWindow() {
        val controller = Robolectric.buildActivity(Screen::class.java).setup().visible()
        val activity = controller.get()
        val settings = RemoteDialog(activity)
        settings.setContentView(Button(activity).apply { text = "Settings" })
        settings.show()
        shadowOf(Looper.getMainLooper()).idle()
        assertSame(settings.window!!.decorView, RemoteUiWindows.activeRoot(activity))
        val nested = RemoteUiWindows.alert(activity).setTitle("Nested").setPositiveButton("Confirm", null).show()
        shadowOf(Looper.getMainLooper()).idle()
        val root = RemoteUiWindows.activeRoot(activity)
        assertSame(nested.window!!.decorView, root)
        RemoteUiNavigator.key(root, KeyEvent.KEYCODE_DPAD_RIGHT)
        assertNotNull(root.findFocus())
        root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK))
        root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK))
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(nested.isShowing)
        assertTrue(settings.isShowing)
        assertSame(settings.window!!.decorView, RemoteUiWindows.activeRoot(activity))
        settings.dismiss()
        assertSame(activity.window.decorView, RemoteUiWindows.activeRoot(activity))
        controller.pause().stop().destroy()
    }

    @Test fun disabledNavigationButtonsDoNotTrapFocus() {
        val controller = Robolectric.buildActivity(Screen::class.java).setup().visible()
        val activity = controller.get()
        activity.buttons[2].apply { isFocusableInTouchMode = true; requestFocus() }
        activity.buttons[3].isEnabled = false
        RemoteUiNavigator.key(activity.window.decorView, KeyEvent.KEYCODE_DPAD_RIGHT)
        assertSame(activity.buttons[4], activity.window.decorView.findFocus())
        controller.pause().stop().destroy()
    }

    @Test fun slidersHandleDirectionsBeforeFocusMovesAndInputTextIsNotExposedAsLabel() {
        val controller = Robolectric.buildActivity(Screen::class.java).setup().visible()
        val activity = controller.get()
        val slider = SeekBar(activity).apply { max = 100; progress = 50; isFocusableInTouchMode = true }
        activity.setContentView(slider)
        shadowOf(Looper.getMainLooper()).idle()
        slider.requestFocus()
        RemoteUiNavigator.key(activity.window.decorView, KeyEvent.KEYCODE_DPAD_RIGHT)
        assertTrue(slider.progress > 50)
        assertTrue(slider.hasFocus())
        assertEquals("", RemoteUiNavigator.label(EditText(activity).apply { setText("private input") }))
        controller.pause().stop().destroy()
    }

    @Test fun remoteCanSelectSettingsChoicesOnOldAndNewAndroid() {
        val controller = Robolectric.buildActivity(Screen::class.java).setup().visible()
        val activity = controller.get()
        val spinner = Spinner(activity).apply {
            adapter = ArrayAdapter(activity, android.R.layout.simple_spinner_item, listOf("First", "Second"))
            isFocusableInTouchMode = true
        }
        activity.setContentView(spinner)
        shadowOf(Looper.getMainLooper()).idle()
        spinner.requestFocus()
        RemoteUiNavigator.key(activity.window.decorView, KeyEvent.KEYCODE_DPAD_CENTER)
        shadowOf(Looper.getMainLooper()).idle()
        val choices = RemoteUiWindows.activeRoot(activity)
        assertNotSame(activity.window.decorView, choices)
        RemoteUiNavigator.key(choices, KeyEvent.KEYCODE_DPAD_DOWN)
        RemoteUiNavigator.key(choices, KeyEvent.KEYCODE_DPAD_CENTER)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, spinner.selectedItemPosition)
        assertSame(activity.window.decorView, RemoteUiWindows.activeRoot(activity))
        controller.pause().stop().destroy()
    }
}
