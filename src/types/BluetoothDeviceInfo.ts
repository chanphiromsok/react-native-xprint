import type { BluetoothMajorDeviceClass } from './BluetoothMajorDeviceClass';

/**
 * A nearby or previously paired Bluetooth Classic device.
 */
export interface BluetoothDeviceInfo {
  /**
   * The device's MAC address, e.g. `'66:32:10:B2:A1:0C'`.
   * This is the stable identifier to pass to `Xprinter.connect(...)`.
   */
  address: string;
  /**
   * The device's advertised name, e.g. `'XP-P323B'`.
   *
   * `undefined` when the device did not report a name, or when the
   * `BLUETOOTH_CONNECT` permission has not been granted (Android 12+).
   */
  name?: string;
  /**
   * Whether this device is already paired (bonded) with the phone.
   * Bonded printers can be connected to without running a discovery scan first.
   */
  isBonded: boolean;
  /**
   * Signal strength in dBm at the moment the device was discovered, e.g. `-54`.
   *
   * Only reported for devices found through `startDiscovery()`; always
   * `undefined` for devices returned by `getBondedDevices()`.
   */
  rssi?: number;
  /**
   * The major class of the device.
   */
  majorDeviceClass: BluetoothMajorDeviceClass;
}
