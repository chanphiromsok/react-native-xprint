import type { LabelMediaType } from './LabelMediaType';

/**
 * The label stock currently loaded in the printer.
 *
 * This is the thing that changes when someone swaps the roll, so it lives on the
 * printer rather than being passed to every print call. Set it once after
 * connecting and every subsequent job sizes and positions itself accordingly.
 */
export interface LabelMedia {
  widthMm: number;
  heightMm: number;
  /** Defaults to `'printerDefault'`, which leaves the printer's own setting alone. */
  type: LabelMediaType;
  /**
   * The gap or black-mark height, for `'gap'` and `'blackMark'` stock.
   * Ignored otherwise.
   */
  separationMm?: number;
}
