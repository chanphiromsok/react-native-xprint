import type { HybridObject } from 'react-native-nitro-modules';
import type { BluetoothDeviceInfo } from '../types/BluetoothDeviceInfo';
import type { BluetoothPermissionStatus } from '../types/BluetoothPermissionStatus';
import type { ListenerSubscription } from '../types/ListenerSubscription';
import type { BluetoothPrinter } from './BluetoothPrinter.nitro';

/**
 * Discovers nearby Bluetooth Classic printers and opens connections to them.
 *
 * @platform android Bluetooth Classic (SPP) is implemented on Android only.
 * On iOS every method rejects and `isSupported` is `false`, because iOS does not
 * expose Bluetooth Classic to third-party apps — an iOS printer connection needs
 * BLE or an MFi-certified accessory.
 */
export interface XprinterBluetooth extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  /**
   * Whether this platform and device can talk to Bluetooth Classic printers at
   * all. `false` on iOS, and on Android devices without a Bluetooth adapter.
   */
  readonly isSupported: boolean;
  /** Whether the Bluetooth adapter is currently turned on. */
  readonly isEnabled: boolean;
  /** Whether a discovery scan is currently running. */
  readonly isDiscovering: boolean;
  /**
   * The current permission state, without prompting the user.
   *
   * Never reports `'blocked'` — use the result of `requestPermissions()` to tell
   * a re-askable `'denied'` apart from a permanent one.
   */
  readonly permissionStatus: BluetoothPermissionStatus;
  /**
   * Prompts for the Bluetooth permissions this library needs
   * (`BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` on Android 12+, `ACCESS_FINE_LOCATION`
   * below that) and resolves with the resulting state.
   *
   * Resolves with `'granted'` immediately if they are already granted.
   */
  requestPermissions(): Promise<BluetoothPermissionStatus>;
  /**
   * Returns the devices already paired with this phone. This is the fast path:
   * a printer paired once in the system Bluetooth settings shows up here without
   * running a scan.
   */
  getBondedDevices(): Promise<BluetoothDeviceInfo[]>;
  /**
   * Starts scanning for nearby devices. Each device found is delivered to the
   * listeners registered with `addDeviceFoundListener`.
   *
   * Resolves once the scan has started, not when it finishes — Android stops
   * discovery by itself after about 12 seconds, which is reported through
   * `addDiscoveryStateListener`. Starting a scan while one is already running
   * restarts it.
   *
   * Rejects when Bluetooth is off or the required permissions are missing.
   */
  startDiscovery(): Promise<void>;
  /**
   * Stops a running scan. Resolves immediately if no scan is running.
   *
   * Discovery is bandwidth-heavy and slows down any connection attempt, so stop
   * it before calling `connect()`.
   */
  stopDiscovery(): Promise<void>;
  /**
   * Called once for every device found during a scan. A device may be reported
   * more than once within a single scan.
   */
  addDeviceFoundListener(
    listener: (device: BluetoothDeviceInfo) => void
  ): ListenerSubscription;
  /**
   * Called whenever a scan starts or stops, including when Android ends a scan
   * on its own.
   */
  addDiscoveryStateListener(
    listener: (isDiscovering: boolean) => void
  ): ListenerSubscription;
  /**
   * Opens an SPP connection to the device with the given MAC address and
   * resolves with a ready-to-use printer.
   *
   * The device does not need to be bonded beforehand — connecting to an unpaired
   * printer triggers the system pairing dialog.
   *
   * Rejects when the address is unknown, Bluetooth is off, permissions are
   * missing, or the printer refuses the connection.
   *
   * @param address a MAC address from `getBondedDevices()` or a discovery event,
   * e.g. `'66:32:10:B2:A1:0C'`.
   */
  connect(address: string): Promise<BluetoothPrinter>;
}
