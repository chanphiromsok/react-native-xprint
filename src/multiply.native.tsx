import { NitroModules } from 'react-native-nitro-modules';
import type { Xprinter } from './Xprinter.nitro';

const XprinterHybridObject =
  NitroModules.createHybridObject<Xprinter>('Xprinter');

export function multiply(a: number, b: number): number {
  return XprinterHybridObject.multiply(a, b);
}
