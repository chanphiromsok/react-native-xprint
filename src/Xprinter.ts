import { NitroModules } from 'react-native-nitro-modules';
import type { XprinterBluetooth } from './specs/XprinterBluetooth.nitro';

/**
 * The entry point of this library: discovers nearby Bluetooth Classic printers
 * and opens connections to them.
 *
 * @platform android see {@linkcode XprinterBluetooth} for the iOS limitation.
 */
export const Xprinter =
  NitroModules.createHybridObject<XprinterBluetooth>('XprinterBluetooth');
