/**
 * How continuous tones are reduced to the pure black-or-white dots a thermal
 * printer can actually produce.
 */
export type DitherMode =
  /**
   * Every pixel darker than the threshold becomes black. Fast, and the right
   * choice for line art, text, logos and barcodes, where dithering would add
   * noise.
   */
  | 'threshold'
  /**
   * Floyd–Steinberg error diffusion. Reproduces photographs and gradients at the
   * cost of a grainy texture; a poor choice for barcodes.
   */
  | 'floydSteinberg';
