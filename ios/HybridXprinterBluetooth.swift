import Foundation
import NitroModules

/// The iOS implementation of `XprinterBluetooth`.
///
/// iOS does not expose Bluetooth Classic (RFCOMM / SPP) to third-party apps — a
/// printer connection there has to go through Core Bluetooth (BLE) or an
/// MFi-certified accessory via the ExternalAccessory framework. Neither is a
/// drop-in replacement for the Android SPP flow, so rather than pretend, every
/// operation reports that clearly and `isSupported` is `false`.
final class HybridXprinterBluetooth: HybridXprinterBluetoothSpec {
  var isSupported: Bool { false }

  var isEnabled: Bool { false }

  var isDiscovering: Bool { false }

  var permissionStatus: BluetoothPermissionStatus { .denied }

  func requestPermissions() throws -> Promise<BluetoothPermissionStatus> {
    .rejected(withError: UnsupportedPlatformError.bluetoothClassic)
  }

  func getBondedDevices() throws -> Promise<[BluetoothDeviceInfo]> {
    .rejected(withError: UnsupportedPlatformError.bluetoothClassic)
  }

  func startDiscovery() throws -> Promise<Void> {
    .rejected(withError: UnsupportedPlatformError.bluetoothClassic)
  }

  func stopDiscovery() throws -> Promise<Void> {
    .rejected(withError: UnsupportedPlatformError.bluetoothClassic)
  }

  func addDeviceFoundListener(
    listener: @escaping (_ device: BluetoothDeviceInfo) -> Void
  ) throws -> ListenerSubscription {
    throw UnsupportedPlatformError.bluetoothClassic
  }

  func addDiscoveryStateListener(
    listener: @escaping (_ isDiscovering: Bool) -> Void
  ) throws -> ListenerSubscription {
    throw UnsupportedPlatformError.bluetoothClassic
  }

  func connect(address: String) throws -> Promise<(any HybridBluetoothPrinterSpec)> {
    .rejected(withError: UnsupportedPlatformError.bluetoothClassic)
  }
}
