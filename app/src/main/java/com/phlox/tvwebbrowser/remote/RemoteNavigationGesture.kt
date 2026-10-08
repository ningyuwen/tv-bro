package com.phlox.tvwebbrowser.remote

import kotlin.math.abs

/** Turn a continuous drag into deliberate steps without flooding Android focus navigation. */
class RemoteNavigationGesture {
    private var target: Any? = null
    private var x = 0f
    private var y = 0f
    private var lastMove = Long.MIN_VALUE
    private var lastStep = Long.MIN_VALUE

    fun reset() {
        target = null
        x = 0f
        y = 0f
        lastMove = Long.MIN_VALUE
        lastStep = Long.MIN_VALUE
    }

    fun move(dx: Float, dy: Float, target: Any, now: Long): String? {
        if (this.target !== target || lastMove == Long.MIN_VALUE || now - lastMove > 250) reset()
        this.target = target
        lastMove = now
        x = (x + dx).coerceIn(-112f, 112f)
        y = (y + dy).coerceIn(-112f, 112f)
        if (maxOf(abs(x), abs(y)) < 56f || (lastStep != Long.MIN_VALUE && now - lastStep < 120)) return null
        val direction = if (abs(x) >= abs(y)) {
            if (x > 0) "right" else "left"
        } else {
            if (y > 0) "down" else "up"
        }
        x = 0f
        y = 0f
        lastStep = now
        return direction
    }
}
