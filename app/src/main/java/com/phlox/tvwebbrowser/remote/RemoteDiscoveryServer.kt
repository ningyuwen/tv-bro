package com.phlox.tvwebbrowser.remote

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress

/** Replies only to small discovery probes on the local network; never reveals credentials. */
class RemoteDiscoveryServer(private val deviceId: String, private val tcpPort: Int) : AutoCloseable {
    companion object { const val PORT = 8878 }
    private var socket: DatagramSocket? = null
    @Volatile private var active = false
    val port: Int get() = socket?.localPort ?: PORT
    fun start(bindPort: Int = PORT) {
        val udp = DatagramSocket(null).apply { reuseAddress = true; bind(InetSocketAddress(bindPort)) }
        socket = udp
        active = true
        Thread({
            val peers = mutableMapOf<String, Long>()
            while (active) {
                try {
                    val packet = DatagramPacket(ByteArray(513), 513)
                    udp.receive(packet)
                    if (packet.length > 512 || (!packet.address.isSiteLocalAddress && !packet.address.isLoopbackAddress)) continue
                    val request = JSONObject(String(packet.data, 0, packet.length, Charsets.UTF_8))
                    val nonce = request.optString("nonce")
                    if (request.optString("type") != "lime-discover" || request.optInt("v") != 1 || !nonce.matches(Regex("[a-f0-9]{32}"))) continue
                    val peer = packet.address.hostAddress ?: continue
                    val now = System.nanoTime()
                    if (now - (peers[peer] ?: 0L) < 500_000_000L) continue
                    if (peers.size > 64) peers.clear()
                    peers[peer] = now
                    val reply = JSONObject().put("v", 1).put("type", "lime-browser").put("nonce", nonce)
                        .put("deviceId", deviceId).put("name", "青柠浏览器").put("port", tcpPort).toString().toByteArray(Charsets.UTF_8)
                    udp.send(DatagramPacket(reply, reply.size, packet.address, packet.port))
                } catch (_: Exception) { if (udp.isClosed) break }
            }
        }, "LimeDiscovery").apply { isDaemon = true }.start()
    }
    override fun close() { active = false; socket?.close(); socket = null }
}
