package com.phlox.tvwebbrowser.remote

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.phlox.tvwebbrowser.activity.main.MainActivity

/** One LAN connection per browser process, shared by all of its foreground pages. */
class PhoneRemoteSession(private val application: Application) : Application.ActivityLifecycleCallbacks, AutoCloseable {
    private val handler = Handler(Looper.getMainLooper())
    private val started = mutableSetOf<Activity>()
    private var foregroundActivity: Activity? = null
    private val controller = PhoneRemoteController(application, { foregroundActivity }) { activity, command, complete ->
        if (activity is MainActivity) activity.executePhoneCommand(command, complete)
        else complete(runCatching { RemotePageController.execute(activity, command) })
    }
    private val stopIfBackground = Runnable {
        if (started.isEmpty()) controller.close()
    }

    init { application.registerActivityLifecycleCallbacks(this) }

    fun show() = controller.show()

    override fun onActivityStarted(activity: Activity) {
        started.add(activity)
        handler.removeCallbacks(stopIfBackground)
    }

    override fun onActivityResumed(activity: Activity) {
        foregroundActivity = activity
        controller.startIfEnabled()
    }

    override fun onActivityPaused(activity: Activity) {
        if (foregroundActivity === activity) {
            foregroundActivity = null
            controller.dismissDialogs()
        }
    }

    override fun onActivityStopped(activity: Activity) {
        started.remove(activity)
        if (started.isEmpty()) {
            // Also bridge Activity recreation, where the old page stops before the new one starts.
            handler.postDelayed(stopIfBackground, 700)
        }
    }

    override fun onActivityDestroyed(activity: Activity) {
        started.remove(activity)
        if (foregroundActivity === activity) foregroundActivity = null
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

    override fun close() {
        application.unregisterActivityLifecycleCallbacks(this)
        handler.removeCallbacks(stopIfBackground)
        foregroundActivity = null
        started.clear()
        controller.close()
    }
}
