import AVFoundation
import ExpoModulesCore

/**
 The audio of a voice call. One AVAudioEngine records and plays at the same
 time, with Apple's voice processing on the input: echo cancellation, noise
 suppression and gain control. That is what lets the microphone stay open
 while the agent speaks.

 In:  microphone -> mono int16 at `inputRate`, in frames of `frameMs`, as the
      event `onFrame` ({ data: base64, level: 0...1 }).
 Out: `play(pcm, sampleRate)` queues mono int16 PCM. `clear()` drops the queue
      in the middle of a word. The event `onPlayback` says when sound starts
      and ends.
 */

struct DuplexOptions: Record {
  @Field var inputRate: Double = 16000
  @Field var frameMs: Double = 80
  /// The gain of the microphone while the voice plays. 1 leaves it alone.
  @Field var duckGain: Double = 1
  @Field var speaker: Bool = true
  /// Echo cancellation. Off is for a check of the hardware only.
  @Field var voiceProcessing: Bool = true
}

/// The sound of the room may still hold the voice for this long after playback ends.
private let duckTailSeconds = 0.35

public final class HermesDuplexAudioModule: Module {
  private var options = DuplexOptions()
  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var playFormat: AVAudioFormat?
  private var converter: AVAudioConverter?
  private var targetFormat: AVAudioFormat?
  private var observers: [NSObjectProtocol] = []

  private var frame: [Int16] = []
  private var frameSize = 1280
  private var energy: Float = 0
  private var gain: Float = 1

  private let lock = NSLock()
  private var pending = 0
  private var playGeneration = 0
  private var playing = false
  private var playbackEndedAt = Date.distantPast
  private var muted = false
  private var running = false
  private var voiceProcessing = false
  private var taps = 0
  private var convertFailures = 0
  private var hardwareNote = ""

  public func definition() -> ModuleDefinition {
    Name("HermesDuplexAudio")

    Events("onFrame", "onPlayback", "onInterruption")

    AsyncFunction("start") { (options: DuplexOptions) -> [String: Any] in
      try self.start(options)

      return ["voiceProcessing": self.voiceProcessing, "inputRate": options.inputRate]
    }

    Function("stop") {
      self.stop()
    }

    /// Numbers for a check of the audio path.
    Function("stats") { () -> [String: Any] in
      ["taps": self.taps, "convertFailures": self.convertFailures, "hardware": self.hardwareNote,
       "running": self.engine?.isRunning ?? false, "voiceProcessing": self.voiceProcessing]
    }

    Function("play") { (data: ArrayBuffer, sampleRate: Double) in
      self.play(data, sampleRate: sampleRate)
    }

    /// Queue one encoded sound (MP3, WAV, M4A) behind what plays now.
    Function("playEncoded") { (data: ArrayBuffer, fileExtension: String) in
      try self.playEncoded(data.data, fileExtension: fileExtension)
    }

    Function("clear") {
      self.clear()
    }

    Function("setMuted") { (muted: Bool) in
      self.muted = muted
    }

    Function("setSpeaker") { (speaker: Bool) in
      self.options.speaker = speaker
      try? AVAudioSession.sharedInstance().overrideOutputAudioPort(speaker ? .speaker : .none)
    }

    OnDestroy {
      self.stop()
    }
  }

  // MARK: - lifecycle

  private func start(_ options: DuplexOptions) throws {
    stop()
    self.options = options
    frameSize = max(160, Int(options.inputRate * options.frameMs / 1000))

    let session = AVAudioSession.sharedInstance()
    var sessionOptions: AVAudioSession.CategoryOptions = [.allowBluetooth]

    if options.speaker {
      sessionOptions.insert(.defaultToSpeaker)
    }

    try session.setCategory(.playAndRecord, mode: .voiceChat, options: sessionOptions)
    try session.setActive(true)
    try buildEngine()
    running = true
    observe()
  }

  private func stop() {
    running = false
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    tearDownEngine()
    setPlaying(false)
    muted = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func buildEngine() throws {
    let engine = AVAudioEngine()
    let input = engine.inputNode

    // Voice processing must be set before the engine starts. A device (or a
    // Simulator) that cannot do it still gets a call, without echo cancellation.
    voiceProcessing = false

    if options.voiceProcessing {
      do {
        try input.setVoiceProcessingEnabled(true)
        voiceProcessing = true
      } catch {
        voiceProcessing = false
      }
    }

    let player = AVAudioPlayerNode()

    guard let format = playFormat ?? AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false) else {
      throw Exception(name: "DuplexAudioFormat", description: "The playback format is not supported.")
    }

    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)

    let hardware = input.outputFormat(forBus: 0)

    guard hardware.sampleRate > 0, hardware.channelCount > 0,
      let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: options.inputRate, channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: hardware, to: target)
    else {
      throw Exception(name: "DuplexAudioInput", description: "The microphone gave no usable format.")
    }

    hardwareNote = "\(hardware.sampleRate) Hz, \(hardware.channelCount) ch, out \(engine.outputNode.outputFormat(forBus: 0).sampleRate) Hz"
    taps = 0
    convertFailures = 0

    // Voice processing can give several channels. The first one is the processed voice.
    if hardware.channelCount > 1 {
      converter.channelMap = [0]
    }

    input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(hardware.sampleRate * 0.02), format: hardware) { [weak self] buffer, _ in
      self?.capture(buffer)
    }

    self.engine = engine
    self.player = player
    self.playFormat = format
    self.converter = converter
    self.targetFormat = target
    frame.removeAll(keepingCapacity: true)
    frame.reserveCapacity(frameSize)
    energy = 0

    engine.prepare()
    try engine.start()
    player.play()
  }

  private func tearDownEngine() {
    lock.lock()
    playGeneration += 1
    pending = 0
    lock.unlock()

    engine?.inputNode.removeTap(onBus: 0)
    player?.stop()
    engine?.stop()
    engine = nil
    player = nil
    converter = nil
    targetFormat = nil
  }

  private func rebuild() {
    guard running else {
      return
    }

    tearDownEngine()
    setPlaying(false)

    do {
      try AVAudioSession.sharedInstance().setActive(true)
      try buildEngine()
    } catch {
      sendEvent("onInterruption", ["reason": "failed", "message": error.localizedDescription])
    }
  }

  private func observe() {
    let center = NotificationCenter.default

    // A new route (headphones in or out) stops the engine. Build it again on the new hardware.
    observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] note in
      guard let self, let engine = self.engine, (note.object as? AVAudioEngine) === engine, !engine.isRunning else {
        return
      }

      self.rebuild()
    })

    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      guard let self, let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        let kind = AVAudioSession.InterruptionType(rawValue: raw)
      else {
        return
      }

      if kind == .began {
        self.sendEvent("onInterruption", ["reason": "began"])
      } else {
        self.rebuild()
        self.sendEvent("onInterruption", ["reason": "ended"])
      }
    })

    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      self?.rebuild()
    })
  }

  // MARK: - microphone

  private func capture(_ buffer: AVAudioPCMBuffer) {
    taps += 1

    guard let converter, let targetFormat else {
      return
    }

    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * targetFormat.sampleRate / buffer.format.sampleRate) + 16

    guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else {
      return
    }

    var consumed = false
    var error: NSError?

    converter.convert(to: out, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow

        return nil
      }

      consumed = true
      status.pointee = .haveData

      return buffer
    }

    guard error == nil, out.frameLength > 0, let samples = out.int16ChannelData?[0] else {
      convertFailures += 1

      return
    }

    // Duck, never gate: what is left of the voice in the room stays quiet,
    // and the user is still heard over it.
    lock.lock()
    let audible = playing || Date().timeIntervalSince(playbackEndedAt) < duckTailSeconds
    lock.unlock()

    let target: Float = audible ? Float(options.duckGain) : 1
    gain += (target - gain) * 0.3

    for index in 0..<Int(out.frameLength) {
      let raw = Float(samples[index])

      energy += raw * raw
      frame.append(muted ? 0 : Int16(max(-32768, min(32767, raw * gain))))

      if frame.count >= frameSize {
        emitFrame()
      }
    }
  }

  private func emitFrame() {
    let level = muted ? 0 : min(1, (energy / Float(frame.count)).squareRoot() / 32768 * 6)
    let data = frame.withUnsafeBufferPointer { Data(buffer: $0) }

    frame.removeAll(keepingCapacity: true)
    energy = 0
    sendEvent("onFrame", ["data": data.base64EncodedString(), "level": level])
  }

  // MARK: - playback

  private func play(_ data: ArrayBuffer, sampleRate: Double) {
    let count = data.byteLength / 2

    guard running, count > 0, sampleRate > 0,
      let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
      let channel = buffer.floatChannelData?[0]
    else {
      return
    }

    buffer.frameLength = AVAudioFrameCount(count)
    data.withUnsafeBytes { raw in
      for index in 0..<count {
        channel[index] = Float(raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self)) / 32768
      }
    }

    schedule(buffer)
  }

  private func playEncoded(_ data: Data, fileExtension: String) throws {
    guard running, !data.isEmpty else {
      return
    }

    let url = FileManager.default.temporaryDirectory.appendingPathComponent("hermes-voice-\(UUID().uuidString).\(fileExtension)")

    try data.write(to: url)
    defer { try? FileManager.default.removeItem(at: url) }

    let file = try AVAudioFile(forReading: url)

    guard file.length > 0, let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
      return
    }

    try file.read(into: buffer)
    schedule(buffer)
  }

  /// Queue a buffer. The player is connected with the format of what it plays; another format connects it again.
  private func schedule(_ buffer: AVAudioPCMBuffer) {
    guard let engine, let player, buffer.frameLength > 0 else {
      return
    }

    if playFormat != buffer.format {
      engine.disconnectNodeOutput(player)
      engine.connect(player, to: engine.mainMixerNode, format: buffer.format)
      playFormat = buffer.format
    }

    lock.lock()
    pending += 1
    let generation = playGeneration
    lock.unlock()

    setPlaying(true)
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.finished(generation)
    }

    if !player.isPlaying {
      player.play()
    }
  }

  private func finished(_ generation: Int) {
    lock.lock()
    let current = generation == playGeneration

    if current {
      pending = max(0, pending - 1)
    }

    let done = current && pending == 0
    lock.unlock()

    if done {
      setPlaying(false)
    }
  }

  private func clear() {
    lock.lock()
    playGeneration += 1
    pending = 0
    lock.unlock()

    player?.stop()

    if engine?.isRunning == true {
      player?.play()
    }

    setPlaying(false)
  }

  private func setPlaying(_ next: Bool) {
    lock.lock()
    let changed = playing != next

    playing = next

    if changed && !next {
      playbackEndedAt = Date()
    }

    lock.unlock()

    if changed {
      sendEvent("onPlayback", ["playing": next])
    }
  }
}
