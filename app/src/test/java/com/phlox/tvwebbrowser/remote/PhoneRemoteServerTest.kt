package com.phlox.tvwebbrowser.remote

import android.app.Application
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.Socket
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE, application = Application::class)
class PhoneRemoteServerTest {
    private lateinit var server: PhoneRemoteServer
    private val count = AtomicInteger()
    private val time = AtomicLong(System.nanoTime())
    private var sockets = mutableListOf<Socket>()
    @Before fun setup() {
        server = PhoneRemoteServer(now = time::get) { _, authorized -> require(authorized()) { "unauthorized" }; count.incrementAndGet(); JSONObject() }
        server.start(0)
    }
    @After fun cleanup() { sockets.forEach { it.close() }; server.close() }
    private fun socket(): Socket = Socket("127.0.0.1", server.port).also { it.soTimeout = 2000; sockets.add(it) }
    private fun send(socket: Socket, json: JSONObject): JSONObject {
        socket.getOutputStream().write((json.toString() + "\n").toByteArray())
        return JSONObject(socket.getInputStream().bufferedReader().readLine())
    }
    private fun paired(socket: Socket): String = send(socket, JSONObject().put("id", 1).put("op", "pair")
        .put("code", server.beginPairing())).getString("token")

    @Test fun expiredPairingCodeCannotAuthorize() {
        val socket = socket()
        val code = server.beginPairing()
        time.addAndGet(TimeUnit.MINUTES.toNanos(6))
        assertFalse(send(socket, JSONObject().put("id", 1).put("op", "pair").put("code", code)).getBoolean("ok"))
        assertEquals(0, count.get())
    }
    @Test fun approvalIsRequiredAndRateLimited() {
        val socket = socket()
        assertEquals("approval_denied", send(socket, JSONObject().put("id", 1).put("op", "authorize")).getString("error"))
        assertEquals("approval_busy", send(socket, JSONObject().put("id", 2).put("op", "authorize")).getString("error"))
        assertEquals(0, count.get())
    }
    @Test fun approvedCredentialSurvivesServerRestart() {
        server.close()
        var stored: String? = null
        server = PhoneRemoteServer(onToken = { stored = it }, approve = { true }) { _, valid ->
            require(valid()); JSONObject()
        }
        server.start(0)
        val info = send(socket(), JSONObject().put("id", 1).put("op", "info"))
        assertTrue(info.getBoolean("ok"))
        assertFalse(info.has("token"))
        val authorization = send(socket(), JSONObject().put("id", 1).put("op", "authorize"))
        assertTrue(authorization.getBoolean("ok"))
        val token = authorization.getString("token")
        assertEquals(token, stored)
        server.close()
        server = PhoneRemoteServer(initialToken = stored) { _, valid -> require(valid()); JSONObject() }
        server.start(0)
        assertTrue(send(socket(), JSONObject().put("id", 2).put("op", "status").put("token", token)).getBoolean("ok"))
        server.beginPairing()
        assertFalse(send(socket(), JSONObject().put("id", 3).put("op", "status").put("token", token)).getBoolean("ok"))
    }
    @Test fun authorizationCanBeRecheckedAfterCommandWasQueued() {
        server.close()
        server = PhoneRemoteServer { _, valid ->
            server.beginPairing()
            require(valid()) { "unauthorized" }
            count.incrementAndGet()
            JSONObject()
        }
        server.start(0)
        val socket = socket()
        val token = paired(socket)
        assertEquals("unauthorized", send(socket, JSONObject().put("id", 2).put("op", "click").put("token", token)).getString("error"))
        assertEquals(0, count.get())
    }
    @Test fun discoveryRepliesWithIdentityButNoCredential() {
        val discovery = RemoteDiscoveryServer("test-device", server.port)
        discovery.start(0)
        try {
            java.net.DatagramSocket().use { socket ->
                socket.soTimeout = 2000
                val bytes = JSONObject().put("v", 1).put("type", "lime-discover").put("nonce", "a".repeat(32)).toString().toByteArray()
                socket.send(java.net.DatagramPacket(bytes, bytes.size, java.net.InetAddress.getByName("127.0.0.1"), discovery.port))
                val packet = java.net.DatagramPacket(ByteArray(512), 512)
                socket.receive(packet)
                val reply = JSONObject(String(packet.data, 0, packet.length))
                assertEquals("test-device", reply.getString("deviceId"))
                assertEquals(server.port, reply.getInt("port"))
                assertEquals("a".repeat(32), reply.getString("nonce"))
                assertFalse(reply.has("token"))
                assertFalse(reply.has("code"))
            }
        } finally { discovery.close() }
    }
    @Test fun unpairedCommandsCannotExecute() {
        val reply = send(socket(), JSONObject().put("id", 1).put("op", "click"))
        assertEquals("unauthorized", reply.getString("error"))
        assertEquals(0, count.get())
    }
    @Test fun pairedCommandsAndCodeReplay() {
        val socket = socket()
        val code = server.beginPairing()
        val token = send(socket, JSONObject().put("id", 1).put("op", "pair").put("code", code)).getString("token")
        assertTrue(send(socket, JSONObject().put("id", 2).put("op", "click").put("token", token)).getBoolean("ok"))
        assertFalse(send(socket, JSONObject().put("id", 3).put("op", "pair").put("code", code)).getBoolean("ok"))
        assertEquals(1, count.get())
    }
    @Test fun newPairingRevokesOldToken() {
        val socket = socket()
        val token = paired(socket)
        server.beginPairing()
        assertEquals("unauthorized", send(socket, JSONObject().put("id", 2).put("op", "click").put("token", token)).getString("error"))
    }
    @Test fun fragmentedChineseAndMultipleFrames() {
        val socket = socket()
        val token = paired(socket)
        val bytes = (JSONObject().put("id", 2).put("op", "text").put("text", "青柠输入").put("token", token).toString() + "\n" +
            JSONObject().put("id", 3).put("op", "status").put("token", token).toString() + "\n").toByteArray()
        socket.getOutputStream().write(bytes, 0, 15)
        socket.getOutputStream().write(bytes, 15, bytes.size - 15)
        val reader = socket.getInputStream().bufferedReader()
        assertTrue(JSONObject(reader.readLine()).getBoolean("ok"))
        assertEquals(3, JSONObject(reader.readLine()).getInt("id"))
        assertEquals(2, count.get())
    }
    @Test fun oversizedFrameClosesWithoutExecution() {
        val socket = socket()
        socket.getOutputStream().write(ByteArray(RemoteProtocol.MAX_FRAME_BYTES + 2) { 65 })
        assertEquals(-1, socket.getInputStream().read())
        assertEquals(0, count.get())
    }
    @Test fun fiveWrongAttemptsThrottlePairing() {
        val socket = socket()
        val code = server.beginPairing()
        repeat(5) {
            val wrong = if (code == "000000") "111111" else "000000"
            assertFalse(send(socket, JSONObject().put("id", it + 1).put("op", "pair").put("code", wrong)).getBoolean("ok"))
        }
        assertFalse(send(socket, JSONObject().put("id", 6).put("op", "pair").put("code", code)).getBoolean("ok"))
    }
    @Test fun validatorRejectsUnsafeUrlsAndInvalidMoves() {
        for (url in listOf("javascript:alert(1)", "file:///etc/passwd", "intent://evil")) {
            assertThrows(IllegalArgumentException::class.java) { RemoteProtocol.parse(JSONObject().put("op", "open").put("text", url)) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            RemoteProtocol.parse(JSONObject().put("op", "move").put("dx", 501).put("dy", 0))
        }
        assertThrows(IllegalArgumentException::class.java) {
            RemoteProtocol.parse(JSONObject().put("op", "move").put("dx", "1").put("dy", 0))
        }
        assertTrue(RemoteProtocol.parse(JSONObject().put("op", "open").put("text", "中文搜索")) is RemoteCommand.Open)
    }
    @Test fun stopClosesActiveSockets() {
        val socket = socket()
        paired(socket)
        server.close()
        assertEquals(-1, socket.getInputStream().read())
    }

    @Test fun mediaCommandsRequireAuthorizationAndValidatePositions() {
        val socket = socket()
        assertEquals("unauthorized", send(socket, JSONObject().put("id", 1).put("op", "mediaStatus")).getString("error"))
        val token = paired(socket)
        for (op in listOf("mediaStatus", "seekBy", "seekTo", "mediaToggle")) {
            assertTrue(send(socket, JSONObject().put("id", 2).put("op", op).put("token", token)
                .put("mediaId", "video-1").put("seconds", 10)).getBoolean("ok"))
        }
        val executed = count.get()
        for ((op, seconds) in listOf("seekBy" to 601, "seekBy" to -601, "seekTo" to -1, "seekTo" to "10")) {
            assertEquals("invalid_seek", send(socket, JSONObject().put("id", 3).put("op", op).put("token", token)
                .put("mediaId", "video-1").put("seconds", seconds)).getString("error"))
        }
        assertEquals("invalid_media", send(socket, JSONObject().put("id", 4).put("op", "seekTo")
            .put("token", token).put("seconds", 10)).getString("error"))
        assertEquals(executed, count.get())
    }
}
