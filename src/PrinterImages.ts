import { NitroModules } from 'react-native-nitro-modules';
import type { PrinterImageFactory } from './specs/PrinterImageFactory.nitro';

/**
 * Converts images into printer-ready dots. See {@linkcode PrinterImageFactory}.
 */
export const PrinterImages =
  NitroModules.createHybridObject<PrinterImageFactory>('PrinterImageFactory');
