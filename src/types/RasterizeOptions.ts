import type { DitherMode } from './DitherMode';

/**
 * How to turn a source image into printer-ready dots.
 */
export interface RasterizeOptions {
  /**
   * Where to read the document from: an absolute file path, a `file://` URI, or
   * a `content://` URI — for example one returned by an image picker, or by
   * `expo-print`'s `printToFileAsync`.
   *
   * PNG, JPEG, WebP and **PDF** are all accepted; the format is detected from the
   * file's contents, not its extension.
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
   * Which page of a multi-page PDF to render, counting from zero. Defaults to
   * the first page, and is ignored for images.
   *
   * Use {@linkcode PrinterImageFactory.countPages} to find out how many there
   * are.
   */
  pageIndex?: number;
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
  /**
   * Crop a PDF page down to its actual ink before fitting it to
   * `widthDots`/`maxHeightDots`. Ignored for images.
   *
   * An HTML-to-PDF page (from `expo-print` or similar) is usually sized to a
   * fixed sheet — Letter, A4 — regardless of how little the content actually
   * uses. Fitting that whole sheet onto a small label scales the blank space
   * down along with the content, so the result prints small and centred in a
   * sea of margin rather than filling the label. Trimming to the content's
   * own bounding box first means what actually fills the label is the
   * content, not whatever the page happened to be sized to.
   *
   * A blank page has nothing to trim to and renders unchanged.
   */
  trimToContent: boolean;
}
