package com.margelo.nitro.xprinter.extension

import com.margelo.nitro.xprinter.MonochromeRaster
import java.io.ByteArrayOutputStream

/**
 * Encodes this raster as a complete TSPL `BITMAP` command.
 *
 * The command is `BITMAP x,y,widthBytes,height,mode,<data>` followed by CRLF,
 * where mode 0 overwrites whatever is already on the label canvas.
 *
 * TSPL treats a **set** bit as white, which is the opposite of how the raster is
 * stored, so every byte is inverted here.
 */
internal fun MonochromeRaster.toTsplBitmap(xDots: Int, yDots: Int): ByteArray {
  val output = ByteArrayOutputStream(bytes.size + 64)
  output.write("BITMAP $xDots,$yDots,$rowBytes,$heightDots,0,".toByteArray(Charsets.US_ASCII))
  bytes.forEach { byte -> output.write(byte.toInt().inv() and 0xFF) }
  output.write("\r\n".toByteArray(Charsets.US_ASCII))
  return output.toByteArray()
}
