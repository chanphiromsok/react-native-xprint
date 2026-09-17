import type { DitherMode } from './DitherMode';

/**
 * How to turn a source image into printer-ready dots.
 */
export interface RasterizeOptions {
  /**
   * Where to read the image from: an absolute file path, a `file://` URI, or a
   * `content://` URI (for example one returned by an image picker).
   */
  source: string;
  /**
   * The output width in printer dots. The image is scaled to exactly this width
   * and its height follows from the aspect ratio.
   *
   * At 203 dpi a dot is 1/8 mm, so a 70 mm wide label is 560 dots. Keep this at
   * or below the printer's head width or the right edge is clipped.
   */
  widthDots: number;
  /**
   * An optional height ceiling, in dots.
   *
   * Without it the image is scaled to `widthDots` and whatever height the aspect
   * ratio gives — which overflows a short label. With it, the image is scaled
   * down further when needed so the result fits inside `widthDots` x
   * `maxHeightDots`, keeping its aspect ratio. The output is then narrower than
   * `widthDots`, so read `widthDots` back off the result before positioning it.
   */
  maxHeightDots?: number;
  /** How to reduce the image to one bit per pixel. */
  dithering: DitherMode;
  /**
   * The cutoff for `'threshold'` dithering, 0–255 on the luminance scale.
   * Ignored by `'floydSteinberg'`. Defaults to 128 when omitted.
   */
  threshold?: number;
  /**
   * Swap black and white. Useful for white-on-dark source images, which would
   * otherwise print as a solid black block.
   */
  invert: boolean;
  /**
   * Mirror the image left-to-right.
   *
   * Combine with `flipVertical` for a 180° rotation. Printers that feed
   * head-down often need one or both of these, and which one depends on the
   * mechanism, so they are separate switches rather than a single rotation.
   */
  flipHorizontal: boolean;
  /** Mirror the image top-to-bottom. */
  flipVertical: boolean;
}
