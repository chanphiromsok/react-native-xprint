import type { HybridObject } from 'react-native-nitro-modules';
import type { RasterizeOptions } from '../types/RasterizeOptions';
import type { PrinterRaster } from './PrinterRaster.nitro';

/**
 * Turns ordinary images into printer dots.
 *
 * Decoding, scaling and dithering are all native: doing them in JS would mean
 * shipping a full image decoder and moving megabytes of pixels across the
 * bridge for an image the printer reduces to one bit per pixel anyway.
 *
 * This is independent of Bluetooth — the raster it produces can be sent over any
 * transport.
 *
 * @platform android see {@linkcode XprinterBluetooth} for the iOS limitation.
 */
export interface PrinterImageFactory extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  /**
   * Decodes, scales and dithers an image.
   *
   * Rejects if the source cannot be read or decoded, or if `widthDots` is not a
   * positive whole number.
   */
  rasterize(options: RasterizeOptions): Promise<PrinterRaster>;
}
