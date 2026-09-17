/**
 * A position or offset in millimetres.
 *
 * The public API is millimetres throughout, never dots: a physical measurement
 * stays correct when the paper changes, and stays correct on a 300 dpi head
 * where the same distance is a different number of dots. Conversion happens
 * once, inside, using the calibrated `dotsPerMm`.
 */
export interface PointMm {
  x: number;
  y: number;
}
