import CoreBluetooth
import Foundation

/// Snapshots a discovered peripheral into the JS-facing `BluetoothDeviceInfo`.
///
/// See the spec's §2.1/§2.2/§2.4:
/// - `address` carries `identifier.uuidString`, a per-app-installation and
///   per-device token — CoreBluetooth never exposes a hardware MAC address.
/// - `isBonded` means "already connected, or previously retrieved by
///   identifier" rather than "paired in system settings"; there is no
///   Classic bond list on iOS.
/// - `majorDeviceClass` has no BLE source (Class of Device is a Bluetooth
///   Classic concept) and is always `.uncategorized`.
extension CBPeripheral {
  func toDeviceInfo(advertisementData: [String: Any]? = nil, rssi: NSNumber? = nil) -> BluetoothDeviceInfo {
    let localName = advertisementData?[CBAdvertisementDataLocalNameKey] as? String
    let resolvedName = (localName ?? name)?.trimmingCharacters(in: .whitespacesAndNewlines)

    // 127 is CoreBluetooth's documented "RSSI not available" sentinel.
    let resolvedRssi: Double? = (rssi != nil && rssi!.intValue != 127) ? rssi!.doubleValue : nil

    return BluetoothDeviceInfo(
      address: identifier.uuidString,
      name: (resolvedName?.isEmpty == false) ? resolvedName : nil,
      isBonded: state == .connected,
      rssi: resolvedRssi,
      majorDeviceClass: .uncategorized
    )
  }
}
