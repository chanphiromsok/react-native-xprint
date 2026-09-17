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
   * Decodes, scales and dithers an image or one page of a PDF.
   *
   * A PDF page is rendered straight to the requested dot width rather than
   * decoded at some default resolution and scaled up, so text and barcodes stay
   * as sharp as the printer can reproduce them.
   *
   * Rejects if the source cannot be read or decoded, if `widthDots` is not a
   * positive whole number, or if `pageIndex` is past the end of the document.
   */
  rasterize(options: RasterizeOptions): Promise<PrinterRaster>;
  /**
   * How many pages the source has: the page count for a PDF, and `1` for an
   * image.
   *
   * Use it to print a multi-page document one label or receipt per page.
   */
  countPages(source: string): Promise<number>;
}
