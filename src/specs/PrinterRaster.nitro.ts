import type { HybridObject } from 'react-native-nitro-modules';

/**
 * An image that has been scaled and reduced to one bit per pixel, ready to be
 * sent to a printer.
 *
 * The dot data stays native and is only converted when you ask for a specific
 * command language, so rasterizing an image you end up not printing costs no JS
 * memory.
 */
export interface PrinterRaster extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  /** Width in dots — the `widthDots` that was requested. */
  readonly widthDots: number;
  /** Height in dots, derived from the source image's aspect ratio. */
  readonly heightDots: number;
  /** Bytes per row: `ceil(widthDots / 8)`. */
  readonly rowBytes: number;
  /**
   * Encodes the image as a complete TSPL `BITMAP` command, positioned at the
   * given offset from the label's origin, terminated with CRLF.
   *
   * Concatenate it into a TSPL program between `CLS` and `PRINT`.
   */
  toTsplBitmap(xDots: number, yDots: number): ArrayBuffer;
  /**
   * Encodes the image as an ESC/POS `GS v 0` raster bit-image command.
   *
   * Send it to a receipt printer after the usual `ESC @` initialise.
   */
  toEscPosRaster(): ArrayBuffer;
}
