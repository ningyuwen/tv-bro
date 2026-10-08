package com.phlox.tvwebbrowser.remote

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** Foreground LAN endpoint; control always requires a remembered credential or TV approval. */
class PhoneRemoteServer(
    private val now: () -> Long = System::nanoTime,
    initialToken: String? = null,
    private val onToken: (String?) -> Unit = {},
    private val approve: (String) -> Boolean = { false },
    val deviceId: String = java.util.UUID.randomUUID().toString(),
    private val execute: (RemoteCommand, () -> Boolean) -> JSONObject
) : AutoCloseable {
    companion object {
        const val PORT = 8877
        fun addresses(): List<String> = Collections.list(NetworkInterface.getNetworkInterfaces())
            .filter { it.isUp && !it.isLoopback }
            .flatMap { Collections.list(it.inetAddresses) }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress && !it.isLoopbackAddress }
            .map { it.hostAddress!! }.distinct().sorted()
    }
    private val random = SecureRandom()
    private val pool = Executors.newCachedThreadPool { r -> Thread(r, "LimeRemote").apply { isDaemon = true } }
    private val slots = Semaphore(4)
    private val clients = Collections.synchronizedSet(mutableSetOf<Socket>())
    private var listener: ServerSocket? = null
    @Volatile private var active = false
    private var pairCode = ""
    private var pairDeadline = 0L
    private var token: String? = initialToken?.takeIf { it.matches(Regex("[a-f0-9]{64}")) }
    private var approvalBusy = false
    private var lastApproval = Long.MIN_VALUE
    private var failedAttempts = 0
    private var attemptsWindow = 0L
    val port: Int get() = listener?.localPort ?: PORT
    val isRunning: Boolean get() = active

    fun start(bindPort: Int = PORT) {
        check(!active)
        listener = ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(bindPort)) }
        active = true
        pool.execute {
            while (active) {
                val socket = try { listener!!.accept() } catch (_: Exception) { break }
                if (!socket.inetAddress.isSiteLocalAddress && !socket.inetAddress.isLoopbackAddress) {
                    socket.close()
                    continue
                }
                // Closing and accepting must share the same lock so a late accepted socket
                // cannot escape the shutdown snapshot or be submitted to a stopped pool.
                synchronized(clients) {
                    if (!active || !slots.tryAcquire()) {
                        socket.close()
                    } else {
                        clients.add(socket)
                        pool.execute {
                            try { serve(socket) } catch (_: Exception) { /* Disconnect or malformed stream. */ }
                            finally { clients.remove(socket); socket.close(); slots.release() }
                        }
                    }
                }
            }
        }
    }

    @Synchronized fun beginPairing(): String {
        check(active)
        pairCode = "%06d".format(java.util.Locale.ROOT, random.nextInt(1_000_000))
        pairDeadline = now() + TimeUnit.MINUTES.toNanos(5)
        // Rotating the code revokes previously paired controllers.
        token = null
        onToken(null)
        return pairCode
    }

    @Synchronized private fun pair(code: String): String? {
        val now = now()
        if (now - attemptsWindow > TimeUnit.SECONDS.toNanos(30)) {
            attemptsWindow = now
            failedAttempts = 0
        }
        if (failedAttempts >= 5 || pairDeadline == 0L || now > pairDeadline) return null
        if (!constantEquals(code, pairCode)) { failedAttempts++; return null }
        return issueToken()
    }

    @Synchronized private fun issueToken(): String {
        check(active)
        val bytes = ByteArray(32).also(random::nextBytes)
        val result = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
        token = result
        onToken(result)
        pairDeadline = 0L // Pair once. TV can explicitly issue a new code.
        return result
    }

    private fun authorize(address: String): String {
        synchronized(this) {
            val current = now()
            require(!approvalBusy && (lastApproval == Long.MIN_VALUE || current - lastApproval >= TimeUnit.SECONDS.toNanos(30))) { "approval_busy" }
            approvalBusy = true
            lastApproval = current
        }
        try {
            require(approve(address)) { "approval_denied" }
            return issueToken()
        } finally { synchronized(this) { approvalBusy = false } }
    }

    @Synchronized private fun authenticated(value: String): Boolean = token?.let { constantEquals(value, it) } ?: false
    private fun constantEquals(a: String, b: String): Boolean = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

    private fun serve(socket: Socket) {
        socket.tcpNoDelay = true
        socket.soTimeout = 15000
        val input = socket.getInputStream().buffered()
        val output = socket.getOutputStream()
        var window = now()
        var requests = 0
        while (active) {
            val line = readFrame(input) ?: break
            var id = 0L
            val reply = try {
                val request = JSONObject(line)
                id = request.getLong("id")
                require(id > 0) { "invalid_id" }
                val now = now()
                if (now - window >= TimeUnit.SECONDS.toNanos(1)) { window = now; requests = 0 }
                require(++requests <= 120) { "rate_limited" }
                val response = if (request.optString("op") == "info") {
                    JSONObject().put("deviceId", deviceId).put("name", "青柠浏览器").put("protocol", 1).put("mediaControl", 1)
                } else if (request.optString("op") == "authorize") {
                    val issued = authorize(socket.inetAddress.hostAddress ?: "")
                    JSONObject().put("token", issued).put("deviceId", deviceId)
                } else if (request.optString("op") == "pair") {
                    val issued = pair(request.getString("code")) ?: throw IllegalArgumentException("pair_failed")
                    JSONObject().put("token", issued).put("name", "青柠浏览器").put("protocol", 1).put("deviceId", deviceId)
                } else {
                    val suppliedToken = request.optString("token")
                    require(authenticated(suppliedToken)) { "unauthorized" }
                    execute(RemoteProtocol.parse(request)) { active && authenticated(suppliedToken) }
                }
                response.put("ok", true)
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", when (e.message) {
                    "invalid_text", "invalid_coordinate", "empty_text", "invalid_url", "unknown_command",
                    "pair_failed", "unauthorized", "approval_busy", "approval_denied", "rate_limited", "invalid_id", "not_ready", "no_input", "background",
                    "invalid_seek", "invalid_media", "no_media", "media_changed", "media_not_seekable", "media_unsupported", "media_failed" -> e.message
                    else -> "invalid_request"
                })
            }
            output.write((reply.put("id", id).toString() + "\n").toByteArray(Charsets.UTF_8))
            output.flush()
        }
    }

    private fun readFrame(input: InputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (bytes.size() <= RemoteProtocol.MAX_FRAME_BYTES) {
            val b = input.read()
            if (b == -1) return null // Never execute a partial frame.
            if (b == 10) return bytes.toString("UTF-8")
            bytes.write(b)
        }
        throw IllegalArgumentException("frame_too_large")
    }

    override fun close() {
        active = false
        synchronized(this) { token = null; pairDeadline = 0L }
        listener?.close()
        synchronized(clients) { clients.toList().forEach { it.close() } }
        pool.shutdownNow()
    }
}
