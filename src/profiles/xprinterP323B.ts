import type { PrinterCalibration } from '../types/PrinterCalibration';

/**
 * Calibration for the XPrinter XP-P323B, measured on real hardware.
 *
 * The origin offset came off a calibration target: the canvas frame printed
 * 1.6 mm right of the label's left edge and 1.9 mm below its top.
 *
 * `printableWidthMm` is the one value here that is still an assumption for an
 * 80 mm-class head rather than a measurement. It only becomes load-bearing on
 * stock wider than about 70 mm — print {@linkcode tsplCalibrationLabel} on wide
 * stock and see where the frame's right edge stops to pin it down.
 */
export const XPRINTER_P323B: PrinterCalibration = {
  dotsPerMm: 8,
  printableWidthMm: 72,
  originOffsetMm: { x: 2, y: 2 },
  direction: 'normal',
  flipHorizontal: false,
  flipVertical: false,
};
