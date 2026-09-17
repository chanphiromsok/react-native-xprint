package com.margelo.nitro.xprinter

import java.io.ByteArrayOutputStream

/**
 * Encodes this raster as an ESC/POS `GS v 0` raster bit-image command.
 *
 * The header is `1D 76 30 m xL xH yL yH`, where `m = 0` is normal density and
 * the width is given in bytes, the height in dots. A set bit is a black dot,
 * which is how the raster is already stored.
 *
 * Height is capped at 65535 dots by the two-byte field; taller images must be
 * split into several commands.
 */
internal fun MonochromeRaster.toEscPosRaster(): ByteArray {
  require(heightDots <= 0xFFFF) {
    "An ESC/POS raster command cannot be taller than 65535 dots (got $heightDots). " +
      "Scale the image down or split it into slices."
  }
  val output = ByteArrayOutputStream(bytes.size + 8)
  output.write(0x1D)
  output.write(0x76)
  output.write(0x30)
  output.write(0x00)
  output.write(rowBytes and 0xFF)
  output.write((rowBytes shr 8) and 0xFF)
  output.write(heightDots and 0xFF)
  output.write((heightDots shr 8) and 0xFF)
  output.write(bytes)
  return output.toByteArray()
}
