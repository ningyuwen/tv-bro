package com.phlox.tvwebbrowser.remote

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.Context
import android.os.Build
import android.view.View
import android.view.Window
import android.view.inspector.WindowInspector
import java.lang.ref.WeakReference
import com.phlox.tvwebbrowser.utils.activity

/** Public window inspection on newer TVs, explicit registration on Android 7/8/9. */
object RemoteUiWindows {
    private val windows = mutableListOf<WeakReference<Window>>()

    fun track(window: Window?) {
        if (window == null || windows.any { it.get() === window }) return
        windows.removeAll { it.get() == null }
        windows.add(WeakReference(window))
    }

    fun activeRoot(activity: Activity): View {
        if (Build.VERSION.SDK_INT >= 29) {
            WindowInspector.getGlobalWindowViews().lastOrNull {
                it.isAttachedToWindow && it.hasWindowFocus() &&
                    it.activity === activity
            }?.let { return it }
        }
        return activeWindow(activity).decorView
    }

    fun activeWindow(activity: Activity): Window {
        windows.removeAll { it.get() == null }
        return windows.asReversed().mapNotNull { it.get() }.firstOrNull {
            it.decorView.isAttachedToWindow && it.decorView.isShown &&
                it.decorView.activity === activity
        } ?: activity.window
    }

    fun alert(context: Context): AlertDialog.Builder = object : AlertDialog.Builder(context) {
        override fun create(): AlertDialog = super.create().also { track(it.window) }
    }

    fun compatAlert(context: Context): androidx.appcompat.app.AlertDialog.Builder =
        object : androidx.appcompat.app.AlertDialog.Builder(context) {
            override fun create(): androidx.appcompat.app.AlertDialog = super.create().also { track(it.window) }
        }
}

open class RemoteDialog(context: Context, theme: Int = 0) : Dialog(context, theme) {
    override fun onStart() {
        super.onStart()
        RemoteUiWindows.track(window)
    }
}
