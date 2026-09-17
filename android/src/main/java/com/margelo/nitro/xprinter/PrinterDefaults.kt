package com.margelo.nitro.xprinter

/**
 * What a connection assumes about a printer before anything better is known.
 */
internal object PrinterDefaults {
  /** 203 dpi, the resolution of nearly every portable thermal head. */
  private const val DOTS_PER_MM_203_DPI = 8.0

  /** An 80 mm-class head prints about 72 mm of it. */
  private const val PRINTABLE_WIDTH_MM = 72.0

  /**
   * A neutral starting point: right way up, no mirroring, origin assumed to be
   * the paper's corner.
   *
   * Every one of these is wrong on some printer, which is the point of making
   * them settable rather than baking them in.
   */
  fun calibration(): PrinterCalibration =
    PrinterCalibration(
      dotsPerMm = DOTS_PER_MM_203_DPI,
      printableWidthMm = PRINTABLE_WIDTH_MM,
      originOffsetMm = PointMm(x = 0.0, y = 0.0),
      direction = LabelDirection.NORMAL,
      flipHorizontal = false,
      flipVertical = false,
    )
}
