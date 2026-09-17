package com.margelo.nitro.xprinter

/**
 * An image reduced to one bit per pixel, packed row by row, most significant bit
 * leftmost.
 *
 * A set bit means a **black** dot. That matches ESC/POS; TSPL uses the opposite
 * polarity and the TSPL encoder inverts on the way out.
 */
internal class MonochromeRaster(
  val widthDots: Int,
  val heightDots: Int,
  val bytes: ByteArray,
) {
  /** Bytes per row. The last byte of a row is padded when the width is not a multiple of 8. */
  val rowBytes: Int = (widthDots + 7) / 8

  init {
    require(bytes.size == rowBytes * heightDots) {
      "Raster data is ${bytes.size} bytes, but ${widthDots}x$heightDots needs ${rowBytes * heightDots}."
    }
  }
}
