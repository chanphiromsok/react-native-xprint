/**
 * The major device class a Bluetooth Classic device advertises about itself.
 *
 * Most thermal receipt printers (including XPrinter models) report `'imaging'`,
 * but some cheaper firmwares report `'uncategorized'` or `'misc'`, so treat this
 * as a hint for sorting/filtering a device list rather than a reliable filter.
 */
export type BluetoothMajorDeviceClass =
  | 'misc'
  | 'computer'
  | 'phone'
  | 'networking'
  | 'audioVideo'
  | 'peripheral'
  | 'imaging'
  | 'wearable'
  | 'toy'
  | 'health'
  | 'uncategorized';
