@preconcurrency import CoreBluetooth
import Foundation
import NitroModules

/// Owns the single `CBCentralManager` this library uses.
///
/// Created lazily by the first *action* that needs it (`requestPermissions`,
/// `startDiscovery`, `getBondedDevices`, `connect`) — never by a getter, so
/// that a cold `Xprinter.isEnabled` read cannot trigger the one-time system
/// permission prompt as a side effect. See the spec's §2.6.
///
/// Every mutable property below is confined to `queue`, which is also the
/// queue `CBCentralManager` delivers its delegate callbacks on, so this
/// class never needs a separate lock — `@unchecked Sendable` records that
/// invariant for the compiler instead of leaving every capture of `self` a
/// warning.
final class BluetoothCentral: NSObject, @unchecked Sendable {
  static let shared = BluetoothCentral()

  let queue: DispatchQueue
  let discovery: BluetoothDiscoverySession

  private var manager: CBCentralManager?
  private(set) var currentState: CBManagerState = .unknown

  private var firstStateContinuations: [CheckedContinuation<CBManagerState, Never>] = []
  private var connectContinuations: [UUID: CheckedContinuation<CBPeripheral, Error>] = [:]
  private var connectTimeouts: [UUID: DispatchWorkItem] = [:]
  private var links: [UUID: PrinterPeripheralLink] = [:]

  private override init() {
    let queue = DispatchQueue(label: "com.margelo.nitro.xprinter.central")
    self.queue = queue
    self.discovery = BluetoothDiscoverySession(queue: queue)
    super.init()

    // Safe to create the central right away when authorization is already
    // settled — only a `.notDetermined` authorization triggers the one-time
    // system prompt, and this app has already been through that if it gets
    // here. Doing this eagerly, rather than waiting for some future action
    // to ask for it, is what lets `isEnabled` reflect the real adapter
    // state shortly after launch instead of reporting `false` forever on
    // every run after the first (see `BluetoothPermissions.request()`).
    if CBManager.authorization != .notDetermined {
      queue.async { [weak self] in
        guard let self, self.manager == nil else { return }
        self.manager = CBCentralManager(delegate: self, queue: self.queue)
      }
    }
  }

  /// Whether Bluetooth is currently on, read without ever creating the
  /// manager — see the type doc for why a getter must not have that side
  /// effect.
  var isEnabledWithoutPrompting: Bool {
    manager != nil && currentState == .poweredOn
  }

  var isDiscovering: Bool { discovery.isDiscovering }

  /// Creates the manager if needed, waits for its first
  /// `centralManagerDidUpdateState` callback — CoreBluetooth's state is
  /// `.unknown` until then — and returns the resolved state.
  @discardableResult
  func ensureManagerAndWaitForFirstState() async -> CBManagerState {
    await withCheckedContinuation { (continuation: CheckedContinuation<CBManagerState, Never>) in
      queue.async {
        if self.currentState != .unknown {
          continuation.resume(returning: self.currentState)
          return
        }
        self.firstStateContinuations.append(continuation)
        if self.manager == nil {
          self.manager = CBCentralManager(delegate: self, queue: self.queue)
        }
      }
    }
  }

  func addDeviceFoundListener(_ listener: @escaping (BluetoothDeviceInfo) -> Void) -> ListenerSubscription {
    discovery.addDeviceListener(listener)
  }

  func addDiscoveryStateListener(_ listener: @escaping (Bool) -> Void) -> ListenerSubscription {
    discovery.addStateListener(listener)
  }

  func startDiscovery() async throws {
    try await BluetoothPreflight.requireReady()
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      queue.async {
        if let manager = self.manager {
          self.discovery.start(using: manager)
        }
        continuation.resume()
      }
    }
  }

  func stopDiscovery() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      queue.async {
        if let manager = self.manager {
          self.discovery.stop(using: manager)
        }
        continuation.resume()
      }
    }
  }

  /// Retrieves a previously-seen peripheral by identifier, opens a
  /// connection, resolves its serial characteristics, and returns a ready
  /// link.
  ///
  /// Stops any running scan first — same reason and severity as on Android:
  /// an active scan starves the connection interval.
  func connect(identifier: UUID, connectTimeoutMs: Int = 10000) async throws -> PrinterPeripheralLink {
    try await BluetoothPreflight.requireReady()

    let peripheral = try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<CBPeripheral, Error>) in
      queue.async {
        guard let manager = self.manager else {
          continuation.resume(withResult: .failure(RuntimeError.error(withMessage: "Bluetooth is not ready.")))
          return
        }
        self.discovery.stop(using: manager)

        let target = manager.retrievePeripherals(withIdentifiers: [identifier]).first
          ?? self.discovery.cachedPeripheral(for: identifier)
        guard let target else {
          continuation.resume(
            withResult: .failure(
              RuntimeError.error(
                withMessage: "This printer was set up on another device; set it up again here."
              )
            )
          )
          return
        }

        self.connectContinuations[identifier] = continuation
        let timeout = DispatchWorkItem {
          guard let pending = self.connectContinuations.removeValue(forKey: identifier) else { return }
          manager.cancelPeripheralConnection(target)
          pending.resume(
            withResult: .failure(RuntimeError.error(withMessage: "Timed out connecting to this printer."))
          )
        }
        self.connectTimeouts[identifier] = timeout
        self.queue.asyncAfter(deadline: .now() + .milliseconds(connectTimeoutMs), execute: timeout)
        manager.connect(target, options: nil)
      }
    }

    let link = PrinterPeripheralLink(peripheral: peripheral)
    queue.async { self.links[identifier] = link }

    do {
      try await link.resolveCharacteristics()
    } catch {
      queue.async {
        self.links.removeValue(forKey: identifier)
        self.manager?.cancelPeripheralConnection(peripheral)
      }
      throw error
    }
    return link
  }

  /// Peripherals the *system* already has connected under one of the given
  /// service UUIDs — the closest iOS analogue to "already paired", since
  /// there is no Bluetooth Classic bond list to read. See the spec's §2.2.
  func connectedPeripherals(withServices services: [CBUUID]) async -> [CBPeripheral] {
    await ensureManagerAndWaitForFirstState()
    return await withCheckedContinuation { (continuation: CheckedContinuation<[CBPeripheral], Never>) in
      queue.async {
        continuation.resume(returning: self.manager?.retrieveConnectedPeripherals(withServices: services) ?? [])
      }
    }
  }

  func forgetLink(identifier: UUID) {
    queue.async {
      guard let manager = self.manager else { return }
      if let peripheral = self.links[identifier]?.peripheral {
        manager.cancelPeripheralConnection(peripheral)
      }
      self.links.removeValue(forKey: identifier)
    }
  }
}

extension BluetoothCentral: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    currentState = central.state
    let continuations = firstStateContinuations
    firstStateContinuations.removeAll()
    continuations.forEach { $0.resume(returning: central.state) }
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    discovery.remember(peripheral)
    discovery.emitDeviceFound(peripheral.toDeviceInfo(advertisementData: advertisementData, rssi: RSSI))
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    connectTimeouts.removeValue(forKey: peripheral.identifier)?.cancel()
    connectContinuations.removeValue(forKey: peripheral.identifier)?.resume(returning: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    connectTimeouts.removeValue(forKey: peripheral.identifier)?.cancel()
    let message = error?.localizedDescription ?? "the printer refused the connection"
    connectContinuations.removeValue(forKey: peripheral.identifier)?.resume(
      withResult: .failure(RuntimeError.error(withMessage: "Could not connect: \(message)."))
    )
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    connectTimeouts.removeValue(forKey: peripheral.identifier)?.cancel()
    let message = error?.localizedDescription
    connectContinuations.removeValue(forKey: peripheral.identifier)?.resume(
      withResult: .failure(
        RuntimeError.error(
          withMessage: "Disconnected before the connection finished: \(message ?? "unknown reason")."
        )
      )
    )
    // BLE reports a disconnect directly, including an unsolicited one
    // (printer powered off, moved out of range) — better information than
    // SPP, which only ever learned about this from a failed write. Route it
    // to the same place so both platforms behave identically from JS.
    links[peripheral.identifier]?.handleDisconnected(error: error)
    links.removeValue(forKey: peripheral.identifier)
  }
}

extension CheckedContinuation where E == Error {
  /// A small `Result`-based convenience so call sites above read as one
  /// `resume` per branch instead of an if/else.
  func resume(withResult result: Result<T, Error>) {
    switch result {
    case .success(let value): resume(returning: value)
    case .failure(let error): resume(throwing: error)
    }
  }
}
