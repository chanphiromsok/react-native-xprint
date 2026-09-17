/**
 * Whether the app is allowed to scan for and connect to Bluetooth devices.
 */
export type BluetoothPermissionStatus =
  /** Every required permission has been granted. */
  | 'granted'
  /** At least one permission is missing, and the user can still be asked for it. */
  | 'denied'
  /**
   * The user denied a permission permanently ("Don't ask again"). Requesting it
   * again does nothing — send the user to the app's system settings instead.
   *
   * Only ever returned by `requestPermissions()`; the synchronous
   * `permissionStatus` getter cannot tell `'blocked'` apart from `'denied'` and
   * reports `'denied'` for both.
   */
  | 'blocked';
