package dev.mygo

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import android.util.Base64
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native Android microphone capture bridge for LingerX live voice sessions.
 * Captures 48 kHz mono PCM16 using VOICE_COMMUNICATION with hardware AEC & NS.
 */
class VoiceMicPlugin : MyGoPlugin {
    private val running = AtomicBoolean(false)
    private var worker: Thread? = null
    private var recorder: AudioRecord? = null
    private var aec: AcousticEchoCanceler? = null
    private var ns: NoiseSuppressor? = null

    override fun call(method: String, args: JSONObject, reply: PluginReply) {
        when (method) {
            "start" -> {
                val rate = maxOf(args.optInt("sampleRate", 48000), 8000)
                val channels = args.optInt("channels", 1).coerceIn(1, 2)
                val frameSamples = maxOf(args.optInt("frameSamples", 960), 160)
                startCapture(rate, channels, frameSamples, reply)
            }
            "stop" -> {
                stopCapture()
                reply.success(null)
            }
            else -> reply.failure(PluginFailure("NoMethod", method))
        }
    }

    private fun startCapture(rate: Int, channels: Int, frameSamples: Int, reply: PluginReply) {
        stopCapture()

        val ctx = PluginHost.context
        if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            reply.failure(PluginFailure("PermissionDenied", "RECORD_AUDIO permission not granted"))
            return
        }

        val channelConfig = if (channels == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
        val minBuf = AudioRecord.getMinBufferSize(rate, channelConfig, AudioFormat.ENCODING_PCM_16BIT)
        val frameBytes = frameSamples * channels * 2
        if (minBuf <= 0) {
            reply.failure(PluginFailure("AudioUnavailable", "Unsupported AudioRecord format ($minBuf)"))
            return
        }

        try {
            val rec = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                rate,
                channelConfig,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBuf, frameBytes * 4)
            )
            if (rec.state != AudioRecord.STATE_INITIALIZED) {
                rec.release()
                reply.failure(PluginFailure("CaptureError", "AudioRecord failed to initialize"))
                return
            }

            if (AcousticEchoCanceler.isAvailable()) {
                aec = AcousticEchoCanceler.create(rec.audioSessionId)?.apply { enabled = true }
            }
            if (NoiseSuppressor.isAvailable()) {
                ns = NoiseSuppressor.create(rec.audioSessionId)?.apply { enabled = true }
            }

            recorder = rec
            running.set(true)
            rec.startRecording()

            val t = Thread({
                Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
                val buf = ByteArray(frameBytes)
                while (running.get()) {
                    var offset = 0
                    while (offset < frameBytes && running.get()) {
                        val read = rec.read(buf, offset, frameBytes - offset)
                        if (read < 0) {
                            if (running.getAndSet(false)) {
                                PluginHost.emit(
                                    "linger_voice_mic",
                                    "error",
                                    JSONObject().put("code", "Interrupted").put("message", "AudioRecord read failed ($read)")
                                )
                            }
                            return@Thread
                        }
                        if (read == 0) continue
                        offset += read
                    }
                    if (!running.get() || offset < frameBytes) break
                    val encoded = Base64.encodeToString(buf, Base64.NO_WRAP)
                    PluginHost.emit(
                        "linger_voice_mic",
                        "frame",
                        JSONObject()
                            .put("pcm", encoded)
                            .put("rate", rate)
                            .put("channels", channels)
                    )
                }
            }, "linger-voice-mic")
            worker = t
            t.start()
            reply.success(null)
        } catch (e: SecurityException) {
            stopCapture()
            reply.failure(PluginFailure("PermissionDenied", e.message ?: "Microphone permission denied"))
        } catch (e: Exception) {
            stopCapture()
            reply.failure(PluginFailure("CaptureError", e.message ?: e.toString()))
        }
    }

    private fun stopCapture() {
        running.set(false)
        val rec = recorder
        recorder = null
        try {
            rec?.stop()
        } catch (_: Exception) {
        }
        val t = worker
        worker = null
        if (t != null && t != Thread.currentThread()) {
            try {
                t.join(500)
            } catch (_: InterruptedException) {
            }
        }
        try {
            rec?.release()
        } catch (_: Exception) {
        }
        try {
            aec?.release()
        } catch (_: Exception) {
        }
        aec = null
        try {
            ns?.release()
        } catch (_: Exception) {
        }
        ns = null
    }
}
