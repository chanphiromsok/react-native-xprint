import Foundation

/// The errors this library raises for capabilities iOS does not offer.
enum UnsupportedPlatformError: LocalizedError {
  /// Bluetooth Classic (RFCOMM / SPP) printing, which is Android-only here.
  case bluetoothClassic

  var errorDescription: String? {
    switch self {
    case .bluetoothClassic:
      return """
        react-native-xprinter supports Bluetooth Classic printers on Android only. \
        iOS does not expose Bluetooth Classic to third-party apps — reaching a \
        printer there requires BLE or an MFi-certified accessory. Guard your code \
        with `Xprinter.isSupported`.
        """
    }
  }
}
