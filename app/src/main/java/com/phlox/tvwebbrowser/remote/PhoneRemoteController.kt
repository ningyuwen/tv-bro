package com.phlox.tvwebbrowser.remote

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.app.AlertDialog
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.Lifecycle
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.phlox.tvwebbrowser.R
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class PhoneRemoteController(
    private val activity: AppCompatActivity,
    private val execute: (RemoteCommand, (Result<JSONObject>) -> Unit) -> Unit
) : AutoCloseable {
    private val handler = Handler(Looper.getMainLooper())
    private var server: PhoneRemoteServer? = null
    var foregroundActivity: Activity? = null
        private set
    private var observingActivities = false
    private val activityObserver = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(current: Activity) { foregroundActivity = current }
        override fun onActivityPaused(current: Activity) {
            if (foregroundActivity === current) foregroundActivity = null
        }
        override fun onActivityStopped(current: Activity) {
            // Moving between browser screens keeps the endpoint alive; leaving the app closes it.
            if (foregroundActivity == null) close()
        }
        override fun onActivityDestroyed(current: Activity) { if (current === activity) close() }
        override fun onActivityCreated(current: Activity, state: Bundle?) {}
        override fun onActivityStarted(current: Activity) {}
        override fun onActivitySaveInstanceState(current: Activity, state: Bundle) {}
    }
    private var dialog: AlertDialog? = null
    private var approvalDialog: AlertDialog? = null
    private var discovery: RemoteDiscoveryServer? = null
    private val prefs = activity.getSharedPreferences("phone_remote", android.content.Context.MODE_PRIVATE)
    private val deviceId = prefs.getString("device_id", null) ?: java.util.UUID.randomUUID().toString().also {
        prefs.edit().putString("device_id", it).apply()
    }

    fun startIfEnabled() {
        if (!prefs.getBoolean("enabled", true) || server != null) return
        try {
            if (!observingActivities) {
                activity.application.registerActivityLifecycleCallbacks(activityObserver)
                observingActivities = true
                foregroundActivity = activity
            }
            // Keep the existing single-phone credential when upgrading to multiple phones.
            val remembered = prefs.getStringSet("tokens", null)?.toSet()
                ?: setOfNotNull(prefs.getString("token", null))
            val running = PhoneRemoteServer(initialTokens = remembered,
                onTokens = { tokens ->
                    prefs.edit().putStringSet("tokens", tokens).remove("token").commit()
                },
                approve = ::approvePhone, deviceId = deviceId, execute = ::onCommand).also { it.start() }
            server = running
            try { discovery = RemoteDiscoveryServer(deviceId, running.port).also { it.start() } }
            catch (_: Exception) { discovery = null } // QR/manual control can still work when UDP is unavailable.
        } catch (_: Exception) { close() }
    }

    private fun approvePhone(address: String): Boolean {
        val expected = server
        val done = CountDownLatch(1)
        val accepted = AtomicBoolean(false)
        val expired = AtomicBoolean(false)
        handler.post {
            if (server !== expected || expected?.isRunning != true || !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                done.countDown()
                return@post
            }
            approvalDialog = AlertDialog.Builder(activity).setTitle(R.string.remote_approval_title)
                .setMessage(activity.getString(R.string.remote_approval_info, address))
                .setPositiveButton(R.string.remote_allow) { _, _ -> if (!expired.get()) accepted.set(true) }
                .setNegativeButton(android.R.string.cancel, null)
                .setOnDismissListener { done.countDown(); approvalDialog = null }.show()
            val shown = approvalDialog
            handler.postDelayed({
                if (done.count > 0L) { expired.set(true); shown?.dismiss() }
            }, 30000)
        }
        if (!done.await(32, TimeUnit.SECONDS)) {
            expired.set(true)
            handler.post { approvalDialog?.dismiss() }
            return false
        }
        return accepted.get() && !expired.get() && server === expected && expected?.isRunning == true
    }

    fun show() {
        val addresses = PhoneRemoteServer.addresses()
        if (addresses.isEmpty()) {
            Toast.makeText(activity, R.string.remote_no_network, Toast.LENGTH_LONG).show()
            return
        }
        if (server == null) {
            AlertDialog.Builder(activity).setTitle(R.string.phone_remote)
                .setMessage(R.string.remote_info)
                .setPositiveButton(R.string.remote_enable) { _, _ -> startPairing(addresses) }
                .setNegativeButton(android.R.string.cancel, null).show()
        } else startPairing(addresses)
    }

    private fun startPairing(addresses: List<String>) {
        try {
            if (server == null) {
                server = run { prefs.edit().putBoolean("enabled", true).apply(); startIfEnabled(); server ?: throw IllegalStateException() }
            }
            val running = server!!
            val code = running.beginPairing()
            val payload = JSONObject().put("v", 1).put("host", addresses.first())
                .put("port", running.port).put("code", code).toString()
            val matrix = MultiFormatWriter().encode(payload, BarcodeFormat.QR_CODE, 320, 320)
            val bitmap = Bitmap.createBitmap(320, 320, Bitmap.Config.ARGB_8888)
            val pixels = IntArray(320 * 320) { i -> if (matrix[i % 320, i / 320]) 0xff000000.toInt() else 0xffffffff.toInt() }
            bitmap.setPixels(pixels, 0, 320, 0, 0, 320, 320)
            val content = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(24, 16, 24, 16)
                addView(ImageView(activity).apply { setImageBitmap(bitmap) }, LinearLayout.LayoutParams(320, 320))
                addView(TextView(activity).apply {
                    text = activity.getString(R.string.remote_info) + "\n\n" + addresses.joinToString("\n") {
                        activity.getString(R.string.remote_pair_details, it, running.port, code)
                    }
                    textSize = 18f
                    setPadding(24, 0, 0, 0)
                }, LinearLayout.LayoutParams(480, LinearLayout.LayoutParams.WRAP_CONTENT))
            }
            dialog?.dismiss()
            dialog = AlertDialog.Builder(activity).setTitle(R.string.phone_remote).setView(content)
                .setPositiveButton(android.R.string.ok, null)
                .setNegativeButton(R.string.remote_stop) { _, _ ->
                    server?.revokeAll()
                    prefs.edit().putBoolean("enabled", false).remove("tokens").remove("token").apply(); close()
                }.show()
        } catch (_: Exception) {
            close()
            Toast.makeText(activity, R.string.remote_error, Toast.LENGTH_LONG).show()
        }
    }

    private fun onCommand(command: RemoteCommand, authorized: () -> Boolean): JSONObject {
        val expected = server
        val done = CountDownLatch(1)
        val expired = AtomicBoolean(false)
        var result = JSONObject()
        var failure: Exception? = null
        handler.post {
            try {
                require(!expired.get() && server === expected && expected?.isRunning == true &&
                    foregroundActivity != null) { "background" }
                require(authorized()) { "unauthorized" }
                dialog?.dismiss()
                dialog = null
                execute(command) { response ->
                    if (!expired.get()) {
                        response.fold({ result = it }, { failure = it as? Exception ?: IllegalStateException(it) })
                        done.countDown()
                    }
                }
            } catch (e: Exception) { failure = e; done.countDown() }
        }
        if (!done.await(2, TimeUnit.SECONDS)) {
            expired.set(true)
            throw IllegalArgumentException("not_ready")
        }
        failure?.let { throw it }
        require(authorized()) { "unauthorized" }
        return result
    }

    override fun close() {
        if (observingActivities) activity.application.unregisterActivityLifecycleCallbacks(activityObserver)
        observingActivities = false
        foregroundActivity = null
        discovery?.close()
        discovery = null
        approvalDialog?.dismiss()
        approvalDialog = null
        server?.close()
        server = null
        dialog?.dismiss()
        dialog = null
    }
}
