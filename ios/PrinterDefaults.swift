import Foundation

/// What a connection assumes about a printer before anything better is known.
enum PrinterDefaults {
  /// 203 dpi, the resolution of nearly every portable thermal head.
  private static let dotsPerMm203Dpi = 8.0

  /// An 80 mm-class head prints about 72 mm of it.
  private static let printableWidthMm = 72.0

  /// A neutral starting point: right way up, no mirroring, origin assumed to be
  /// the paper's corner.
  ///
  /// Every one of these is wrong on some printer, which is the point of making
  /// them settable rather than baking them in.
  static func calibration() -> PrinterCalibration {
    PrinterCalibration(
      dotsPerMm: dotsPerMm203Dpi,
      printableWidthMm: printableWidthMm,
      originOffsetMm: PointMm(x: 0, y: 0),
      direction: .normal,
      flipHorizontal: false,
      flipVertical: false
    )
  }
}
