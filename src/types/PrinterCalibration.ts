import type { LabelDirection } from './LabelDirection';
import type { PointMm } from './PointMm';

/**
 * The fixed physical characteristics of a printer.
 *
 * None of this changes when you swap paper or print a different job — it
 * describes the hardware. Set it once per printer model (ideally from a profile
 * table) and leave it alone.
 */
export interface PrinterCalibration {
  /** Head resolution: 8 at 203 dpi, 11.81 at 300 dpi. */
  dotsPerMm: number;
  /**
   * The widest the head can print, regardless of the paper loaded. Images are
   * clamped to it so a wide image on wide stock cannot run off the head.
   */
  printableWidthMm: number;
  /**
   * How far the printable area starts **inside** the paper's left and top edges.
   *
   * Positive means inset: the XP-P323B's canvas origin sits 2 mm right of and
   * 2 mm below the paper's corner, so this is `{ x: 2, y: 2 }`. Content is
   * shifted back by this much so that placing it at "the middle of the paper"
   * actually puts it there.
   *
   * It also means the printable area is not centered on the paper, so the widest
   * strip that *can* be centered is narrower than both the paper and the head —
   * see `printableWidthMm`.
   *
   * Measure it by printing a calibration target with no offset applied and
   * reading where the canvas frame lands relative to the paper's edges.
   */
  originOffsetMm: PointMm;
  /** Rotation the mechanism needs. */
  direction: LabelDirection;
  /** Mirror left-to-right, for mechanisms that need a flip rather than a rotation. */
  flipHorizontal: boolean;
  /** Mirror top-to-bottom. */
  flipVertical: boolean;
}
