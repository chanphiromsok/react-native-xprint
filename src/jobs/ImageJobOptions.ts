import type { Alignment } from '../types/Alignment';
import type { DitherMode } from '../types/DitherMode';
import type { SizeMm } from '../types/SizeMm';

/**
 * The only things that vary per image job — and every one has a default, so the
 * common case passes none of them.
 *
 * Paper size lives on `printer.media` and the hardware's resolution, printable
 * width, origin offset and orientation live on `printer.calibration`. Swapping
 * the roll or moving to a different printer therefore changes neither this type
 * nor any call site.
 */
export interface ImageJobOptions {
  /** Blank edge kept clear of the printable boundary. Defaults to 2 mm. */
  marginMm: number;
  /** Defaults to `'center'`. */
  align: Alignment;
  /**
   * Defaults to `'threshold'` — receipts and labels are text, rules and
   * barcodes, and diffusing those only adds grain and risks an unscannable
   * barcode. Use `'floydSteinberg'` for photographs.
   */
  dithering: DitherMode;
  /** Invert black and white, for white-on-dark source images. Defaults to false. */
  invert: boolean;
  /**
   * Restrict content to a region of this size, centred on the paper. Defaults to
   * the whole paper less `marginMm`.
   *
   * This is what you want for "print a 50 x 30 design on 70 x 80 stock". Do
   * **not** shrink `printer.media` for that: media describes the paper that is
   * loaded, and TSPL anchors its canvas at the printer's origin, so a smaller
   * canvas lands in the paper's corner rather than its middle.
   */
  contentSizeMm?: SizeMm;
  /**
   * Which page of a multi-page PDF to render, counting from zero. Defaults to
   * the first page, ignored for images.
   */
  pageIndex?: number;
}

/**
 * What every image job does unless told otherwise: centred, with a 2 mm edge,
 * thresholded rather than dithered.
 */
export const DEFAULT_IMAGE_JOB: ImageJobOptions = {
  marginMm: 2,
  align: 'center',
  dithering: 'threshold',
  invert: false,
};
