import CoreBluetooth
import Foundation

/// The current Bluetooth LE authorization state, and the one-shot prompt
/// that asks for it.
///
/// CoreBluetooth has no request API of its own: the system prompt fires the
/// first time a `CBCentralManager` is instantiated with a delegate, once per
/// install, and cannot be triggered a second time. See the spec's §2.6 for
/// the mapping this follows and the one contract wrinkle it leaves for
/// callers: `request()` prompts only on the very first call this app ever
/// makes; every call after an initial denial resolves `.blocked` with no
/// UI, which already matches how `.blocked` is documented elsewhere
/// ("send the user to the app's system settings instead").
enum BluetoothPermissions {
  /// The current state, without prompting. Never reports `.blocked` before
  /// the first prompt has actually run — a re-askable denial and a
  /// permanent one are indistinguishable until then, same as Android.
  static var status: BluetoothPermissionStatus {
    switch CBManager.authorization {
    case .allowedAlways:
      return .granted
    case .notDetermined, .denied, .restricted:
      return .denied
    @unknown default:
      return .denied
    }
  }

  /// Prompts for Bluetooth access if it has never been asked, and resolves
  /// with the resulting state. Resolves `.granted` immediately if already
  /// granted, and `.blocked` immediately (no UI) if a previous call already
  /// used up the one-shot system prompt and it came back denied.
  static func request() async -> BluetoothPermissionStatus {
    switch CBManager.authorization {
    case .allowedAlways:
      // Permission is already settled, so creating the central here cannot
      // trigger the one-time system prompt — only a `.notDetermined`
      // authorization does that. This still has to happen: `isEnabled`
      // reads `BluetoothCentral`'s own `currentState`, which starts out
      // unknown until a central exists, and nothing else creates one once
      // permission was already granted in an earlier run. Skipping this
      // left `isEnabled` stuck reporting `false` forever — Bluetooth
      // reported "off" no matter what the radio was actually doing.
      await BluetoothCentral.shared.ensureManagerAndWaitForFirstState()
      return .granted
    case .denied, .restricted:
      return .blocked
    case .notDetermined:
      break
    @unknown default:
      break
    }

    // Instantiating the central is what triggers the one-time system
    // prompt; wait for the first state callback, then re-read authorization
    // (the state callback itself does not carry the authorization result).
    await BluetoothCentral.shared.ensureManagerAndWaitForFirstState()

    switch CBManager.authorization {
    case .allowedAlways:
      return .granted
    case .denied, .restricted:
      return .blocked
    default:
      return .denied
    }
  }
}
