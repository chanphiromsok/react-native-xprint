package com.margelo.nitro.xprinter

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlin.math.floor

/**
 * The Android implementation of [PrinterImageFactory].
 *
 * Decoding and dithering are CPU-bound and can run for hundreds of milliseconds
 * on a full-width image, so they own an IO scope and never touch the main thread.
 */
@DoNotStrip
class HybridPrinterImageFactory : HybridPrinterImageFactorySpec() {
  private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun rasterize(options: RasterizeOptions): Promise<HybridPrinterRasterSpec> =
    Promise.async(ioScope) {
      require(options.widthDots >= 1 && options.widthDots == floor(options.widthDots)) {
        "widthDots must be a positive whole number of dots (got ${options.widthDots})."
      }
      val context = requireContext()

      val widthDots = options.widthDots.toInt()
      val bitmap = if (SourceFiles.isPdf(context, options.source)) {
        // Rasterize straight to the final fitted size — see PdfPageRenderer.
        PdfPageRenderer.render(
          context,
          options.source,
          options.pageIndex?.toInt() ?: 0,
          widthDots,
          options.maxHeightDots?.toInt()
        )
      } else {
        SourceImageLoader.load(context, options.source)
      }

      try {
        HybridPrinterRaster(MonochromeRasterizer.rasterize(bitmap, options))
      } finally {
        bitmap.recycle()
      }
    }

  override fun countPages(source: String): Promise<Double> =
    Promise.async(ioScope) {
      val context = requireContext()
      if (SourceFiles.isPdf(context, source)) {
        PdfPageRenderer.pageCount(context, source).toDouble()
      } else {
        1.0
      }
    }

  private fun requireContext() = NitroModules.applicationContext
    ?: throw IllegalStateException(
      "No ReactApplicationContext is available yet. Use PrinterImages after " +
        "React Native has finished initializing."
    )
}
