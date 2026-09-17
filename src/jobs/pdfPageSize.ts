import type { LabelMedia } from '../types/LabelMedia';

const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

/**
 * A PDF page size in points — `expo-print`'s `printToFileAsync` takes
 * `width`/`height` in points, not millimetres, which is why this is its own
 * type rather than {@linkcode SizeMm}.
 */
export interface PdfPageSize {
  width: number;
  height: number;
}

/**
 * The PDF page size, in points, that matches a label's own aspect ratio.
 *
 * `expo-print`'s `printToFileAsync` defaults to 612x792 points — US Letter,
 * ratio 0.77 — regardless of what the printer is loaded with. A 70x80 mm
 * label is ratio 0.875, a different shape. Because {@linkcode printImageAsLabel}
 * fits the rendered page inside the label's content area while preserving
 * its aspect ratio, a Letter-shaped PDF is constrained by height: it prints
 * about 59 mm wide on a 70 mm label, leaving white bars down both sides.
 * Sizing the PDF page to the label's own ratio removes them — the content
 * area is then the same shape as the page, so nothing is left over to bar.
 *
 * ```ts
 * const { uri } = await Print.printToFileAsync({
 *   html,
 *   ...pdfPageSizeFor(printer.media!),
 * });
 * ```
 */
export function pdfPageSizeFor(media: LabelMedia): PdfPageSize {
  return {
    width: Math.round((media.widthMm * POINTS_PER_INCH) / MM_PER_INCH),
    height: Math.round((media.heightMm * POINTS_PER_INCH) / MM_PER_INCH),
  };
}
