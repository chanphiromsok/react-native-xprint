import Foundation

/// An image reduced to one bit per pixel, packed row by row, most significant
/// bit leftmost.
///
/// A set bit means a **black** dot. That matches ESC/POS; TSPL uses the
/// opposite polarity and the TSPL encoder inverts on the way out.
final class MonochromeRaster {
  let widthDots: Int
  let heightDots: Int
  let bytes: [UInt8]

  /// Bytes per row. The last byte of a row is padded when the width is not a
  /// multiple of 8.
  let rowBytes: Int

  init(widthDots: Int, heightDots: Int, bytes: [UInt8]) {
    self.widthDots = widthDots
    self.heightDots = heightDots
    self.bytes = bytes
    self.rowBytes = (widthDots + 7) / 8

    precondition(
      bytes.count == rowBytes * heightDots,
      "Raster data is \(bytes.count) bytes, but \(widthDots)x\(heightDots) needs \(rowBytes * heightDots)."
    )
  }
}
