import CoreBluetooth
import Foundation

/// Owns the Bluetooth LE scan and the listeners watching it.
///
/// Unlike Android, `CBCentralManager.scanForPeripherals` runs until told to
/// stop, so this session imposes its own deadline and reports the same
/// `isDiscovering -> false` transition Android reports from its own
/// ~12 second hardware timeout, so both platforms present one contract to
/// JS. See the spec's §2.3 — an un-stopped BLE scan drains battery in a way
/// Android's fixed window does not, so this deadline is not a nicety.
///
/// Every method here must be called on `queue` (owned by `BluetoothCentral`,
/// which also delivers `CBCentralManagerDelegate` callbacks there) — this
/// type does no locking of its own.
final class BluetoothDiscoverySession {
  private static let scanDurationSeconds: TimeInterval = 12

  private let queue: DispatchQueue
  private let deviceListeners = ListenerRegistry<(BluetoothDeviceInfo) -> Void>()
  private let stateListeners = ListenerRegistry<(Bool) -> Void>()
  private var deadlineWorkItem: DispatchWorkItem?

  /// Peripherals seen via a scan in this session, so `connect(address:)` has
  /// a fallback when `retrievePeripherals(withIdentifiers:)` does not know
  /// about a printer that was only ever discovered, never connected to. See
  /// the spec's §4.1.
  private var discovered: [UUID: CBPeripheral] = [:]

  private(set) var isDiscovering = false

  init(queue: DispatchQueue) {
    self.queue = queue
  }

  func addDeviceListener(_ listener: @escaping (BluetoothDeviceInfo) -> Void) -> ListenerSubscription {
    ListenerSubscription(remove: deviceListeners.add(listener))
  }

  func addStateListener(_ listener: @escaping (Bool) -> Void) -> ListenerSubscription {
    ListenerSubscription(remove: stateListeners.add(listener))
  }

  func remember(_ peripheral: CBPeripheral) {
    discovered[peripheral.identifier] = peripheral
  }

  func cachedPeripheral(for identifier: UUID) -> CBPeripheral? {
    discovered[identifier]
  }

  /// Starts a scan, restarting one that is already running.
  func start(using manager: CBCentralManager) {
    deadlineWorkItem?.cancel()
    manager.scanForPeripherals(withServices: nil, options: nil)
    let workItem = DispatchWorkItem { [weak self] in
      self?.stop(using: manager)
    }
    deadlineWorkItem = workItem
    queue.asyncAfter(deadline: .now() + Self.scanDurationSeconds, execute: workItem)
    setDiscovering(true)
  }

  /// Stops a running scan. Does nothing when no scan is running.
  func stop(using manager: CBCentralManager) {
    deadlineWorkItem?.cancel()
    deadlineWorkItem = nil
    if manager.isScanning {
      manager.stopScan()
    }
    setDiscovering(false)
  }

  func emitDeviceFound(_ device: BluetoothDeviceInfo) {
    deviceListeners.forEach { $0(device) }
  }

  func dispose() {
    deadlineWorkItem?.cancel()
    deadlineWorkItem = nil
    deviceListeners.clear()
    stateListeners.clear()
    discovered.removeAll()
    isDiscovering = false
  }

  private func setDiscovering(_ discovering: Bool) {
    guard isDiscovering != discovering else { return }
    isDiscovering = discovering
    stateListeners.forEach { $0(discovering) }
  }
}
