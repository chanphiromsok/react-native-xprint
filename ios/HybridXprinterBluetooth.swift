import CoreBluetooth
import Foundation
import NitroModules

/// The iOS implementation of `XprinterBluetooth`.
///
/// iOS does not expose Bluetooth Classic (RFCOMM/SPP) to third-party apps,
/// but — per `docs/ios-implementation-spec.md` §1 — most current XPrinter
/// hardware, including the XP-P323B, is dual-mode and reachable over
/// Bluetooth LE via the same approach XPrinter's own iOS SDK uses. This
/// class discovers and connects over CoreBluetooth; per-model reachability
/// is still a real limit (a Bluetooth-Classic-only printer has no path from
/// here, or from anyone, on iOS), which surfaces as a specific error from
/// `connect()` rather than a blanket "unsupported".
final class HybridXprinterBluetooth: HybridXprinterBluetoothSpec {
  private let central = BluetoothCentral.shared

  /// Read without ever creating the `CBCentralManager` — see
  /// `BluetoothCentral`'s doc for why a getter must not have that side
  /// effect (creating it is what triggers the one-time system prompt).
  var isSupported: Bool {
    CBManager.authorization != .restricted
  }

  var isEnabled: Bool {
    central.isEnabledWithoutPrompting
  }

  var isDiscovering: Bool {
    central.isDiscovering
  }

  var permissionStatus: BluetoothPermissionStatus {
    BluetoothPermissions.status
  }

  func requestPermissions() throws -> Promise<BluetoothPermissionStatus> {
    Promise.async {
      await BluetoothPermissions.request()
    }
  }

  func getBondedDevices() throws -> Promise<[BluetoothDeviceInfo]> {
    Promise.async {
      // There is no Classic bond list on iOS — see the spec's §2.2. This
      // reports peripherals the system already has connected under a known
      // service family, which is the closest honest analogue: "paired in
      // system settings" simply does not exist as a concept here.
      try await BluetoothPreflight.requireReady()
      let knownServices = [
        CBUUID(string: "18F0"),
        CBUUID(string: "FFF0"),
        CBUUID(string: "49535343-FE7D-4AE5-8FA9-9FAFD205E455"),
      ]
      let peripherals = await self.central.connectedPeripherals(withServices: knownServices)
      return peripherals.map { $0.toDeviceInfo() }
    }
  }

  func startDiscovery() throws -> Promise<Void> {
    Promise.async {
      try await self.central.startDiscovery()
    }
  }

  func stopDiscovery() throws -> Promise<Void> {
    Promise.async {
      await self.central.stopDiscovery()
    }
  }

  func addDeviceFoundListener(listener: @escaping (BluetoothDeviceInfo) -> Void) throws -> ListenerSubscription {
    central.addDeviceFoundListener(listener)
  }

  func addDiscoveryStateListener(listener: @escaping (Bool) -> Void) throws -> ListenerSubscription {
    central.addDiscoveryStateListener(listener)
  }

  func connect(address: String) throws -> Promise<(any HybridBluetoothPrinterSpec)> {
    Promise.async {
      guard let identifier = UUID(uuidString: address) else {
        throw RuntimeError.error(withMessage: "'\(address)' is not a valid printer identifier.")
      }
      let link = try await self.central.connect(identifier: identifier)
      let device = link.peripheral.toDeviceInfo()
      return HybridBluetoothPrinter(link: link, device: device) as any HybridBluetoothPrinterSpec
    }
  }
}
