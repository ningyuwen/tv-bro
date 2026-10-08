package com.phlox.tvwebbrowser.remote

import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Spinner

object RemoteUiNavigator {
    fun key(root: View, key: Int) {
        ensureFocus(root)
        val spinner = root.findFocus() as? Spinner
        if (key == KeyEvent.KEYCODE_DPAD_CENTER && spinner != null && spinner.isEnabled) {
            // Framework dropdown windows cannot be inspected through public APIs before API 29.
            // A registered choice dialog also gives remote users a larger, predictable target.
            val adapter = spinner.adapter ?: return
            val labels = Array(adapter.count) { adapter.getItem(it).toString() }
            RemoteUiWindows.alert(spinner.context)
                .setSingleChoiceItems(labels, spinner.selectedItemPosition) { dialog, index ->
                    spinner.setSelection(index)
                    dialog.dismiss()
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
            return
        }
        // Views such as lists, sliders and text editors get first refusal.
        val handled = root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, key))
        root.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, key))
        if (handled) return
        val direction = when (key) {
            KeyEvent.KEYCODE_DPAD_LEFT -> View.FOCUS_LEFT
            KeyEvent.KEYCODE_DPAD_RIGHT -> View.FOCUS_RIGHT
            KeyEvent.KEYCODE_DPAD_UP -> View.FOCUS_UP
            KeyEvent.KEYCODE_DPAD_DOWN -> View.FOCUS_DOWN
            else -> return
        }
        // Synthetic events bypass ViewRootImpl's final focus-navigation stage.
        val focused = root.findFocus() ?: return
        val visited = mutableSetOf(focused)
        var next = focused.focusSearch(direction)
        while (next != null && visited.add(next)) {
            if (next.isShown && next.isEnabled && next.isFocusable) {
                focus(next, direction)
                return
            }
            next = next.focusSearch(direction)
        }
    }

    private fun focus(view: View, direction: Int = View.FOCUS_FORWARD) {
        view.isFocusableInTouchMode = true
        view.requestFocus(direction)
    }

    private fun ensureFocus(root: View) {
        if (root.findFocus() != null) return
        val candidates = arrayListOf<View>()
        root.addFocusables(candidates, View.FOCUS_FORWARD, View.FOCUSABLES_ALL)
        candidates.firstOrNull { it.isShown && it.isEnabled && it !== root }?.let { focus(it) }
    }

    fun label(view: View?): String {
        if (view == null) return ""
        view.contentDescription?.takeIf { it.isNotBlank() }?.let { return it.toString().take(120) }
        if (view is android.widget.AdapterView<*>) return label(view.selectedView)
        if (view is android.widget.EditText) return view.hint?.toString()?.take(120) ?: ""
        if (view is TextView) return view.text.toString().take(120)
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val child = view.getChildAt(i)
                if (!child.isShown) continue
                label(child).takeIf { it.isNotBlank() }?.let { return it }
            }
        }
        return ""
    }
}
