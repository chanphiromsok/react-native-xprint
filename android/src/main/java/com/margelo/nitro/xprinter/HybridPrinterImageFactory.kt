package com.margelo.nitro.xprinter

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

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
      require(options.widthDots >= 1 && options.widthDots == Math.floor(options.widthDots)) {
        "widthDots must be a positive whole number of dots (got ${options.widthDots})."
      }
      val context = NitroModules.applicationContext
        ?: throw IllegalStateException(
          "No ReactApplicationContext is available yet. Use PrinterImages after " +
            "React Native has finished initializing."
        )

      val bitmap = SourceImageLoader.load(context, options.source)
      try {
        HybridPrinterRaster(MonochromeRasterizer.rasterize(bitmap, options))
      } finally {
        bitmap.recycle()
      }
    }
}
