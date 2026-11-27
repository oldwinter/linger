import AVFoundation
import Foundation

/// Native iOS microphone capture bridge for LingerX live voice sessions.
/// Configures AVAudioSession in .playAndRecord / .voiceChat mode so iOS
/// hardware echo cancellation (AEC) runs seamlessly alongside mygo/audio playback.
final class VoiceMicPlugin: MyGoPlugin {
    private let lock = NSLock()
    private var engine: AVAudioEngine?
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var pendingPCM = Data()
    private var frameBytes = 960 * 2
    private var targetRate = 48000
    private var targetChannels = 1
    private var running = false
    private var interruptionObserver: NSObjectProtocol?

    func call(_ method: String, _ args: [String: Any], _ reply: @escaping PluginReply) {
        switch method {
        case "start":
            let rate = max(args["sampleRate"] as? Int ?? 48000, 8000)
            let channels = max(min(args["channels"] as? Int ?? 1, 2), 1)
            let frameSamples = max(args["frameSamples"] as? Int ?? 960, 160)
            startCapture(rate: rate, channels: channels, frameSamples: frameSamples, reply: reply)
        case "stop":
            stopCapture()
            reply(.success(nil))
        default:
            reply(.failure(PluginFailure("NoMethod", method)))
        }
    }

    private func startCapture(rate: Int, channels: Int, frameSamples: Int, reply: @escaping PluginReply) {
        stopCapture()

        let authStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        if authStatus == .denied || authStatus == .restricted {
            reply(.failure(PluginFailure("PermissionDenied", "Microphone permission denied")))
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetooth]
            )
            try session.setPreferredSampleRate(Double(rate))
            try session.setPreferredIOBufferDuration(0.02)
            try session.setActive(true)

            let audioEngine = AVAudioEngine()
            let inputNode = audioEngine.inputNode
            let inputFormat = inputNode.outputFormat(forBus: 0)
            guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
                reply(.failure(PluginFailure("AudioUnavailable", "No active audio input format")))
                return
            }

            guard let outFormat = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: Double(rate),
                channels: AVAudioChannelCount(channels),
                interleaved: true
            ) else {
                reply(.failure(PluginFailure("FormatError", "Unsupported output PCM format")))
                return
            }

            guard let audioConverter = AVAudioConverter(from: inputFormat, to: outFormat) else {
                reply(.failure(PluginFailure("ConverterError", "Unable to create AVAudioConverter")))
                return
            }

            lock.lock()
            engine = audioEngine
            converter = audioConverter
            targetFormat = outFormat
            targetRate = rate
            targetChannels = channels
            frameBytes = frameSamples * channels * 2
            pendingPCM.removeAll(keepingCapacity: true)
            running = true
            lock.unlock()

            interruptionObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: session,
                queue: nil
            ) { [weak self] note in
                guard let info = note.userInfo,
                      let rawType = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                      let type = AVAudioSession.InterruptionType(rawValue: rawType),
                      type == .began
                else { return }
                self?.stopCapture()
                PluginHost.emit("linger_voice_mic", "interrupted", ["reason": "audio_session_interrupted"])
            }

            let tapFrames = AVAudioFrameCount(max(Double(frameSamples) * inputFormat.sampleRate / Double(rate), 256.0))
            inputNode.installTap(onBus: 0, bufferSize: tapFrames, format: inputFormat) { [weak self] buffer, _ in
                self?.handleInputBuffer(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()
            reply(.success(nil))
        } catch {
            stopCapture()
            reply(.failure(PluginFailure("CaptureError", error.localizedDescription)))
        }
    }

    private func handleInputBuffer(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        guard running, let converter, let outFormat = targetFormat else {
            lock.unlock()
            return
        }
        let ratio = outFormat.sampleRate / max(buffer.format.sampleRate, 1.0)
        let outCap = AVAudioFrameCount(max(ceil(Double(buffer.frameLength) * ratio) + 32.0, 256.0))
        guard let converted = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: outCap) else {
            lock.unlock()
            return
        }

        var supplied = false
        var convError: NSError?
        converter.convert(to: converted, error: &convError) { _, outStatus in
            if supplied {
                outStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            outStatus.pointee = .haveData
            return buffer
        }

        if convError != nil || converted.frameLength == 0 {
            lock.unlock()
            return
        }

        let audioBuffers = UnsafeMutableAudioBufferListPointer(converted.mutableAudioBufferList)
        guard let first = audioBuffers.first, let rawPtr = first.mData, first.mDataByteSize > 0 else {
            lock.unlock()
            return
        }
        pendingPCM.append(rawPtr.assumingMemoryBound(to: UInt8.self), count: Int(first.mDataByteSize))

        var chunks: [Data] = []
        while pendingPCM.count >= frameBytes {
            chunks.append(pendingPCM.prefix(frameBytes))
            pendingPCM.removeFirst(frameBytes)
        }
        let rate = targetRate
        let channels = targetChannels
        lock.unlock()

        for chunk in chunks {
            PluginHost.emit("linger_voice_mic", "frame", [
                "pcm": chunk.base64EncodedString(),
                "rate": rate,
                "channels": channels
            ])
        }
    }

    private func stopCapture() {
        lock.lock()
        let activeEngine = engine
        let observer = interruptionObserver
        engine = nil
        converter = nil
        targetFormat = nil
        interruptionObserver = nil
        pendingPCM.removeAll(keepingCapacity: false)
        running = false
        lock.unlock()

        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
        if let activeEngine {
            activeEngine.inputNode.removeTap(onBus: 0)
            activeEngine.stop()
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
