import { PrinterImages, type BluetoothPrinter } from 'react-native-xprinter';
import { escPosInit } from './escpos';
import { tsplProgram, type LabelSize } from './tspl';

/** Dots per millimetre on a 203 dpi head. */
const DOTS_PER_MM = 8;

/**
 * How a TSPL label is oriented on the paper. `1` rotates the output 180°, which
 * is what portable printers that feed head-down need.
 */
export type LabelDirection = 0 | 1;

export interface LabelImageOptions {
  size: LabelSize;
  /** Mirror the image left-to-right before printing. */
  flipHorizontal: boolean;
  /** Mirror the image top-to-bottom before printing. */
  flipVertical: boolean;
  /**
   * Nudge the centered bitmap, in dots. Use this when the printable area is not
   * centered on the paper, which is common and varies by mechanism.
   */
  offsetXDots: number;
  offsetYDots: number;
  /**
   * Blank margin on every edge. A little inset keeps the image clear of the
   * printable-area boundary, which is narrower than the paper on most printers
   * and otherwise clips the first column of dots.
   */
  marginMm: number;
  direction: LabelDirection;
}

/** Concatenates several command chunks into the single buffer sent to the printer. */
function concat(chunks: ArrayBuffer[]): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

/**
 * Rasterizes an image and prints it centered on a TSPL label.
 *
 * `'threshold'` rather than error diffusion: an invoice is text, rules and a
 * barcode, and dithering those would only add grain and risk an unscannable
 * barcode.
 */
export async function printImageAsLabel(
  printer: BluetoothPrinter,
  source: string,
  options: LabelImageOptions
): Promise<void> {
  const labelWidthDots = Math.floor(options.size.widthMm * DOTS_PER_MM);
  const labelHeightDots = Math.floor(options.size.heightMm * DOTS_PER_MM);
  const marginDots = Math.floor(options.marginMm * DOTS_PER_MM);

  const raster = await PrinterImages.rasterize({
    source,
    widthDots: labelWidthDots - marginDots * 2,
    dithering: 'threshold',
    invert: false,
    flipHorizontal: options.flipHorizontal,
    flipVertical: options.flipVertical,
  });

  // Center it, nudge by the calibration offset, and never place the origin off
  // the top-left of the label.
  const x = Math.max(
    0,
    Math.floor((labelWidthDots - raster.widthDots) / 2) + options.offsetXDots
  );
  const y = Math.max(
    0,
    Math.floor((labelHeightDots - raster.heightDots) / 2) + options.offsetYDots
  );

  const payload = concat([
    tsplProgram([
      `SIZE ${options.size.widthMm} mm,${options.size.heightMm} mm`,
      `DIRECTION ${options.direction}`,
      'CLS',
    ]),
    raster.toTsplBitmap(x, y),
    tsplProgram(['PRINT 1,1']),
  ]);
  await printer.write(payload);
}

/** Rasterizes an image and prints it as an ESC/POS raster bit image. */
export async function printImageAsReceipt(
  printer: BluetoothPrinter,
  source: string,
  widthDots: number
): Promise<void> {
  const raster = await PrinterImages.rasterize({
    source,
    widthDots,
    dithering: 'threshold',
    invert: false,
    flipHorizontal: false,
    flipVertical: false,
  });

  await printer.write(
    concat([
      escPosInit(),
      raster.toEscPosRaster(),
      Uint8Array.from([0x0a, 0x0a, 0x0a, 0x0a]).buffer,
    ])
  );
}
