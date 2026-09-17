package com.margelo.nitro.xprinter

import android.graphics.Bitmap
import android.graphics.Matrix

/**
 * Scales a bitmap to the printer's dot width and reduces it to one bit per
 * pixel.
 *
 * Thermal heads can only burn a dot or not, so continuous tone has to go
 * somewhere: either it is thrown away at a threshold, which keeps text and
 * barcodes crisp, or it is diffused into neighbouring pixels, which keeps
 * photographs recognisable at the cost of grain.
 */
internal object MonochromeRasterizer {
  private const val DEFAULT_THRESHOLD = 128

  fun rasterize(bitmap: Bitmap, options: RasterizeOptions): MonochromeRaster {
    val widthDots = options.widthDots.toInt()
    val heightDots = heightFor(bitmap, widthDots)
    val scaled = scaleAndFlip(bitmap, widthDots, heightDots, options)

    val luminance = luminanceOf(scaled, options.invert)
    if (scaled != bitmap) {
      scaled.recycle()
    }

    val threshold = options.threshold?.toInt() ?: DEFAULT_THRESHOLD
    when (options.dithering) {
      DitherMode.THRESHOLD -> Unit
      DitherMode.FLOYDSTEINBERG -> diffuseError(luminance, widthDots, heightDots, threshold)
    }

    return MonochromeRaster(widthDots, heightDots, pack(luminance, widthDots, heightDots, threshold))
  }

  /**
   * Scales to the target size and mirrors in one pass.
   *
   * A negative scale factor mirrors along that axis; `createBitmap` works out
   * the resulting bounds, so the output is still `widthDots` x `heightDots`.
   */
  private fun scaleAndFlip(
    bitmap: Bitmap,
    widthDots: Int,
    heightDots: Int,
    options: RasterizeOptions,
  ): Bitmap {
    val matrix = Matrix().apply {
      setScale(
        (if (options.flipHorizontal) -1f else 1f) * widthDots / bitmap.width,
        (if (options.flipVertical) -1f else 1f) * heightDots / bitmap.height,
      )
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  /** Preserves the aspect ratio, and never rounds a visible image down to nothing. */
  private fun heightFor(bitmap: Bitmap, widthDots: Int): Int =
    maxOf(1, Math.round(bitmap.height.toFloat() * widthDots / bitmap.width))

  /**
   * Flattens to perceptual grey using the Rec. 601 weights, compositing any
   * transparency onto white so a transparent PNG background does not print as a
   * solid black block.
   */
  private fun luminanceOf(bitmap: Bitmap, invert: Boolean): IntArray {
    val pixels = IntArray(bitmap.width * bitmap.height)
    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)

    return IntArray(pixels.size) { index ->
      val pixel = pixels[index]
      val alpha = (pixel ushr 24) and 0xFF
      val red = (pixel ushr 16) and 0xFF
      val green = (pixel ushr 8) and 0xFF
      val blue = pixel and 0xFF
      val grey = (red * 299 + green * 587 + blue * 114) / 1000
      val overWhite = (grey * alpha + 255 * (255 - alpha)) / 255
      if (invert) 255 - overWhite else overWhite
    }
  }

  /**
   * Floyd–Steinberg: each pixel's rounding error is pushed onto the neighbours
   * that have not been decided yet, spreading 7/16 right, and 3/16, 5/16, 1/16
   * across the row below.
   */
  private fun diffuseError(luminance: IntArray, width: Int, height: Int, threshold: Int) {
    for (y in 0 until height) {
      for (x in 0 until width) {
        val index = y * width + x
        val old = luminance[index]
        val new = if (old < threshold) 0 else 255
        luminance[index] = new
        val error = old - new

        if (x + 1 < width) {
          luminance[index + 1] += error * 7 / 16
        }
        if (y + 1 < height) {
          if (x > 0) {
            luminance[index + width - 1] += error * 3 / 16
          }
          luminance[index + width] += error * 5 / 16
          if (x + 1 < width) {
            luminance[index + width + 1] += error * 1 / 16
          }
        }
      }
    }
  }

  /** Packs into rows of bytes, most significant bit leftmost, a set bit meaning black. */
  private fun pack(luminance: IntArray, width: Int, height: Int, threshold: Int): ByteArray {
    val rowBytes = (width + 7) / 8
    val packed = ByteArray(rowBytes * height)

    for (y in 0 until height) {
      for (x in 0 until width) {
        if (luminance[y * width + x] >= threshold) {
          continue // white: leave the bit clear
        }
        val target = y * rowBytes + (x / 8)
        packed[target] = (packed[target].toInt() or (0x80 shr (x % 8))).toByte()
      }
    }
    return packed
  }
}
