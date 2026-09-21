@preconcurrency import CoreBluetooth
import Foundation
import NitroModules

/// The CoreBluetooth transport for one connected peripheral: characteristic
/// resolution, the serial write queue, chunking, the notify inbox, and the
/// `CBPeripheralDelegate` callbacks.
///
/// All mutable state here is confined to `queue`, a dedicated serial queue —
/// the direct equivalent of the Kotlin transport's single-threaded socket
/// executor (`Executors.newSingleThreadExecutor`), and a deliberately
/// simpler stand-in for the `actor`-based design in the spec's §4.3: a
/// serial queue gives the same "one owner, writes complete in call order"
/// property without an `actor`'s reentrancy rules, which are easy to get
/// subtly wrong in a file this size that cannot be checked against real
/// hardware before landing.
final class PrinterPeripheralLink: NSObject, @unchecked Sendable {
  let peripheral: CBPeripheral
  private let queue = DispatchQueue(label: "com.margelo.nitro.xprinter.peripheral-link")

  private var writeCharacteristic: CBCharacteristic?
  private var notifyCharacteristic: CBCharacteristic?
  private var writeType: CBCharacteristicWriteType = .withResponse

  private var pendingWrite: CheckedContinuation<Void, Error>?
  private var pendingWriteWithoutResponse:
    (chunk: Data, characteristic: CBCharacteristic, continuation: CheckedContinuation<Void, Error>)?
  private var pendingRead: (maxBytes: Int, continuation: CheckedContinuation<Data, Never>)?
  private var readTimeoutWorkItem: DispatchWorkItem?
  private var discoverContinuation: CheckedContinuation<Void, Error>?
  private var remainingServicesToDiscover = 0
  private var discoveredPairs: [(CBService, CBCharacteristic)] = []

  private var inbox = Data()
  private(set) var isClosed = false

  /// Known BLE-serial service families this class of printer has been seen
  /// to use — evidence, not a guarantee; see the spec's §4.2. Used only to
  /// rank candidates when several qualify, never to filter out an unknown
  /// one.
  private static let knownServiceUUIDs: Set<CBUUID> = [
    CBUUID(string: "18F0"),
    CBUUID(string: "FFF0"),
    CBUUID(string: "49535343-FE7D-4AE5-8FA9-9FAFD205E455"),
  ]

  init(peripheral: CBPeripheral) {
    self.peripheral = peripheral
    super.init()
    peripheral.delegate = self
  }

  var isConnected: Bool {
    !isClosed && peripheral.state == .connected && writeCharacteristic != nil
  }

  /// The negotiated per-write ceiling for the resolved write characteristic.
  /// Logged at connect time in `resolveCharacteristics()` — see the spec's
  /// §4.4: never hardcode a chunk size on iOS the way Android's constant
  /// 512-byte pacing chunk can, because BLE's ceiling is a hard limit that
  /// differs per connection.
  private var maximumWriteLength: Int {
    max(1, peripheral.maximumWriteValueLength(for: writeType))
  }

  /// Discovers every service and characteristic on the peripheral, then
  /// resolves the write/notify pair by their *properties* — never by a
  /// hardcoded UUID, because the exact UUIDs this class of printer uses are
  /// not known in advance (see the spec's §4.2 and its GATT-UUID
  /// assumption). Enables notifications on the resolved notify
  /// characteristic before returning.
  func resolveCharacteristics() async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      queue.async {
        self.discoverContinuation = continuation
        self.discoveredPairs.removeAll()
        self.peripheral.discoverServices(nil)
      }
    }
  }

  /// Writes `data`, split into pieces no larger than the peripheral's
  /// negotiated write ceiling, and resolves once every piece has been
  /// accepted (acknowledged, when the resolved characteristic supports
  /// `.write`) — the BLE analogue of the Kotlin transport's RFCOMM-paced
  /// chunking, except the chunk size here is a hard per-connection limit
  /// rather than a pacing choice. See the spec's §4.4.
  func write(_ data: Data) async throws {
    guard let writeCharacteristic else {
      throw RuntimeError.error(
        withMessage: "This printer is reachable over Bluetooth LE but exposes no writable serial "
          + "service. It may be a Bluetooth Classic-only model, which iOS cannot reach."
      )
    }
    let started = DispatchTime.now()
    var offset = 0
    var chunkCount = 0
    let chunkSize = maximumWriteLength
    while offset < data.count {
      if isClosed {
        throw RuntimeError.error(withMessage: "The connection was closed mid-write.")
      }
      let end = min(offset + chunkSize, data.count)
      try await writeOneChunk(data.subdata(in: offset..<end), characteristic: writeCharacteristic)
      offset = end
      chunkCount += 1
    }
    let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000
    // See the spec's §4.4 — this is the number that tells us whether a slow
    // print is the BLE chunk ceiling (many small chunks, long elapsed time)
    // or something else entirely.
    print(
      String(
        format: "[Xprinter] wrote %d bytes in %d chunks (chunkSize=%d) in %.0fms",
        data.count, chunkCount, chunkSize, elapsedMs
      )
    )
  }

  private func writeOneChunk(_ chunk: Data, characteristic: CBCharacteristic) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      queue.async {
        if self.isClosed {
          continuation.resume(throwing: RuntimeError.error(withMessage: "The connection was closed mid-write."))
          return
        }
        switch self.writeType {
        case .withResponse:
          // Resumed from `peripheral(_:didWriteValueFor:error:)` below —
          // this is the backpressure that keeps the print head from being
          // overrun, the same property Android's chunking reaches for by
          // blocking on a socket write.
          self.pendingWrite = continuation
          self.peripheral.writeValue(chunk, for: characteristic, type: .withResponse)
        case .withoutResponse:
          // CoreBluetooth never calls back to confirm this write type, so
          // there is nothing to await for the write itself — but firing it
          // while the OS's internal buffer is full is how these SDKs drop
          // the middle of a label (see the spec's §4.4), so this still
          // gates on `canSendWriteWithoutResponse`, deferring to
          // `peripheralIsReady(toSendWriteWithoutResponse:)` when it is
          // not ready. A characteristic only reaches this branch when it
          // has no `.write` (with-response) property at all; see
          // `selectCharacteristics()`.
          if self.peripheral.canSendWriteWithoutResponse {
            self.peripheral.writeValue(chunk, for: characteristic, type: .withoutResponse)
            continuation.resume()
          } else {
            self.pendingWriteWithoutResponse = (chunk, characteristic, continuation)
          }
        @unknown default:
          self.peripheral.writeValue(chunk, for: characteristic, type: .withoutResponse)
          continuation.resume()
        }
      }
    }
  }

  /// Reads whatever has arrived since the last `read()`, up to `maxBytes`,
  /// giving up after `timeoutMs` and resolving with however much arrived —
  /// an empty buffer when nothing did. Reproduces the Kotlin transport's
  /// `readWithin` semantics without its 10ms poll loop, which existed only
  /// to work around `BluetoothSocket`'s input stream having no timeout; a
  /// notify-driven inbox needs no polling.
  ///
  /// The inbox is cleared at the start of every read: bytes can arrive here
  /// when nobody is reading (there is no equivalent on SPP), and an
  /// unsolicited status byte left over from a previous command must not get
  /// spliced onto this read's reply.
  func read(maxBytes: Int, timeoutMs: Int) async -> Data {
    await withCheckedContinuation { (continuation: CheckedContinuation<Data, Never>) in
      queue.async {
        self.inbox.removeAll(keepingCapacity: true)
        self.readTimeoutWorkItem?.cancel()

        if maxBytes <= 0 {
          continuation.resume(returning: Data())
          return
        }

        let workItem = DispatchWorkItem { [weak self] in
          guard let self, let pending = self.pendingRead else { return }
          self.pendingRead = nil
          pending.continuation.resume(returning: self.drainInbox(maxBytes: pending.maxBytes))
        }
        self.readTimeoutWorkItem = workItem
        self.pendingRead = (maxBytes: maxBytes, continuation: continuation)
        self.queue.asyncAfter(deadline: .now() + .milliseconds(max(0, timeoutMs)), execute: workItem)
      }
    }
  }

  func close() {
    queue.async {
      self.closeLocked(reason: "The connection was closed.")
    }
  }

  /// Called by `BluetoothCentral` when CoreBluetooth reports this
  /// peripheral disconnected — including an unsolicited disconnect (printer
  /// powered off, moved out of range), which BLE reports directly where SPP
  /// only ever learned about it from a failed write.
  func handleDisconnected(error: Error?) {
    queue.async {
      let reason = error.map { "Disconnected: \($0.localizedDescription)." } ?? "The printer disconnected."
      self.closeLocked(reason: reason)
    }
  }

  /// Must be called on `queue`.
  private func closeLocked(reason: String) {
    guard !isClosed else { return }
    isClosed = true
    let error = RuntimeError.error(withMessage: reason)

    discoverContinuation?.resume(throwing: error)
    discoverContinuation = nil

    pendingWrite?.resume(throwing: error)
    pendingWrite = nil

    pendingWriteWithoutResponse?.continuation.resume(throwing: error)
    pendingWriteWithoutResponse = nil

    readTimeoutWorkItem?.cancel()
    readTimeoutWorkItem = nil
    if let pendingRead {
      self.pendingRead = nil
      pendingRead.continuation.resume(returning: Data())
    }
  }

  private func drainInbox(maxBytes: Int) -> Data {
    let take = min(maxBytes, inbox.count)
    let result = Data(inbox.prefix(take))
    inbox.removeFirst(take)
    return result
  }

  /// Picks the write and notify characteristics from every characteristic
  /// discovered across every service, by property rather than by UUID (see
  /// the spec's §4.2), preferring a candidate whose *service* matches a
  /// known family when more than one qualifies.
  ///
  /// The write characteristic prefers one with the `.write` property (which
  /// supports `.withResponse`, giving per-write acknowledgement — see
  /// `write(_:)` above) over one that only has `.writeWithoutResponse`. This
  /// is a deliberate refinement of the spec's own §4.2 pseudocode, which
  /// listed the opposite preference order: that ordering does not hold up
  /// against the spec's *own* §4.4 reasoning that `.withResponse` should be
  /// preferred for the backpressure it gives, and a characteristic without
  /// the `.write` property cannot be written `.withResponse` at all.
  private func selectCharacteristics() {
    func pick(properties: CBCharacteristicProperties) -> (CBService, CBCharacteristic)? {
      let matching = discoveredPairs.filter { $0.1.properties.contains(properties) }
      return matching.first { Self.knownServiceUUIDs.contains($0.0.uuid) } ?? matching.first
    }

    let writeWithResponse = pick(properties: .write)
    let writeChoice = writeWithResponse ?? pick(properties: .writeWithoutResponse)
    let notifyChoice = pick(properties: .notify)

    guard let writeChoice else {
      finishDiscovery(
        with: RuntimeError.error(
          withMessage: "This printer is reachable over Bluetooth LE but exposes no writable serial "
            + "service. It may be a Bluetooth Classic-only model, which iOS cannot reach."
        )
      )
      return
    }

    writeCharacteristic = writeChoice.1
    writeType = writeWithResponse != nil ? .withResponse : .withoutResponse
    notifyCharacteristic = notifyChoice?.1

    if let notifyCharacteristic {
      peripheral.setNotifyValue(true, for: notifyCharacteristic)
    }

    // See the spec's §4.4: the negotiated MTU is the single number that
    // predicts whether iOS printing feels acceptable on a given
    // phone/printer pair — log it on every connect rather than finding out
    // from a slow print with no diagnostic trail.
    print(
      "[Xprinter] BLE link ready: write=\(writeChoice.1.uuid) type=\(writeType == .withResponse ? "withResponse" : "withoutResponse")"
        + " maxWriteLen(withResponse)=\(peripheral.maximumWriteValueLength(for: .withResponse))"
        + " maxWriteLen(withoutResponse)=\(peripheral.maximumWriteValueLength(for: .withoutResponse))"
        + " notify=\(notifyChoice?.1.uuid.uuidString ?? "none")"
    )

    finishDiscovery(with: nil)
  }

  /// Must be called on `queue`.
  private func finishDiscovery(with error: Error?) {
    guard let continuation = discoverContinuation else { return }
    discoverContinuation = nil
    if let error {
      continuation.resume(throwing: error)
    } else {
      continuation.resume()
    }
  }
}

extension PrinterPeripheralLink: CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    queue.async {
      if let error {
        self.finishDiscovery(with: error)
        return
      }
      let services = peripheral.services ?? []
      if services.isEmpty {
        self.finishDiscovery(with: RuntimeError.error(withMessage: "This printer advertises no Bluetooth LE services."))
        return
      }
      self.remainingServicesToDiscover = services.count
      services.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    queue.async {
      self.remainingServicesToDiscover -= 1
      if error == nil {
        (service.characteristics ?? []).forEach { characteristic in
          self.discoveredPairs.append((service, characteristic))
        }
      }
      if self.remainingServicesToDiscover <= 0 {
        self.selectCharacteristics()
      }
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    queue.async {
      guard let pending = self.pendingWrite else { return }
      self.pendingWrite = nil
      if let error {
        self.closeLocked(reason: "Write failed: \(error.localizedDescription). The printer may have been powered off or moved out of range.")
        pending.resume(throwing: error)
      } else {
        pending.resume()
      }
    }
  }

  func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    queue.async {
      guard let pending = self.pendingWriteWithoutResponse else { return }
      self.pendingWriteWithoutResponse = nil
      self.peripheral.writeValue(pending.chunk, for: pending.characteristic, type: .withoutResponse)
      pending.continuation.resume()
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    queue.async {
      guard error == nil, let data = characteristic.value, !data.isEmpty else { return }
      self.inbox.append(data)
      guard let pending = self.pendingRead, self.inbox.count >= pending.maxBytes else { return }
      self.pendingRead = nil
      self.readTimeoutWorkItem?.cancel()
      self.readTimeoutWorkItem = nil
      pending.continuation.resume(returning: self.drainInbox(maxBytes: pending.maxBytes))
    }
  }
}
