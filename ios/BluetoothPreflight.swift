import CoreBluetooth
import Foundation
import NitroModules

/// The checks that must pass before any Bluetooth LE call is worth making.
///
/// Keeping them here lets the HybridObjects read as a single guard instead
/// of repeating adapter, power-state and permission handling in every
/// method — mirrors `BluetoothPreflight.kt`'s three-check shape and, where
/// the underlying condition matches, its exact message text; see the
/// spec's §5.2.
enum BluetoothPreflight {
  /// - Throws: an error naming the fix, exactly as `BluetoothPreflight.kt`
  ///   does — no Bluetooth LE hardware, missing/blocked permission, or
  ///   Bluetooth turned off.
  static func requireReady() async throws {
    switch CBManager.authorization {
    case .restricted:
      throw RuntimeError.error(withMessage: "This device cannot use Bluetooth LE.")
    case .denied:
      throw RuntimeError.error(
        withMessage: "Bluetooth access was turned off for this app. Re-enable it in Settings."
      )
    case .notDetermined:
      throw RuntimeError.error(withMessage: "Call Xprinter.requestPermissions() first.")
    case .allowedAlways:
      break
    @unknown default:
      throw RuntimeError.error(withMessage: "Call Xprinter.requestPermissions() first.")
    }

    let state = await BluetoothCentral.shared.ensureManagerAndWaitForFirstState()
    switch state {
    case .poweredOn:
      return
    case .unsupported:
      throw RuntimeError.error(withMessage: "This device cannot use Bluetooth LE.")
    case .unauthorized:
      throw RuntimeError.error(
        withMessage: "Bluetooth access was turned off for this app. Re-enable it in Settings."
      )
    default:
      // .poweredOff, .resetting, .unknown
      throw RuntimeError.error(
        withMessage: "Bluetooth is turned off. Ask the user to enable it before scanning or connecting."
      )
    }
  }
}
