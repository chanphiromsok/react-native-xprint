package com.margelo.nitro.xprinter

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer

/**
 * Holds rasterized dots natively and hands JS only the encoding it asks for.
 *
 * A full-width label is tens of kilobytes of dot data; converting it eagerly
 * into a JS `ArrayBuffer` would pay that cost even when the caller never prints
 * the image.
 */
@DoNotStrip
internal class HybridPrinterRaster(
  private val raster: MonochromeRaster,
) : HybridPrinterRasterSpec() {
  override val widthDots: Double
    get() = raster.widthDots.toDouble()

  override val heightDots: Double
    get() = raster.heightDots.toDouble()

  override val rowBytes: Double
    get() = raster.rowBytes.toDouble()

  /** The dot data lives on the native heap, where the JS GC cannot see it. */
  override val memorySize: Long
    get() = raster.bytes.size.toLong()

  override fun toTsplBitmap(xDots: Double, yDots: Double): ArrayBuffer =
    ArrayBuffer.copy(raster.toTsplBitmap(xDots.toInt(), yDots.toInt()))

  override fun toEscPosRaster(): ArrayBuffer =
    ArrayBuffer.copy(raster.toEscPosRaster())
}
