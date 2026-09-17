package com.margelo.nitro.xprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import java.io.IOException

/**
 * Renders PDF pages to bitmaps at whatever resolution the printer needs.
 */
internal object PdfPageRenderer {
  fun pageCount(context: Context, source: String): Int =
    SourceFiles.openDescriptor(context, source).use { descriptor ->
      PdfRenderer(descriptor).use { renderer -> renderer.pageCount }
    }

  /**
   * Renders one page sized to fit [targetWidthDots] wide and, if given,
   * [maxHeightDots] tall — the same box the rasterizer would otherwise shrink
   * the bitmap into after the fact.
   *
   * Rendering straight to the final size matters: a PDF is vector art, so
   * rasterizing once at the size the image will actually be keeps text and
   * barcode bars as crisp as the head can reproduce. Rendering at
   * [targetWidthDots] and letting the rasterizer scale down again to fit
   * [maxHeightDots] would soften those edges — twice, once per resample —
   * before the dithering step ever sees them, and burns the CPU time of a
   * second scale for no benefit.
   *
   * @throws IOException if the page does not exist or the document cannot be
   * opened.
   */
  fun render(
    context: Context,
    source: String,
    pageIndex: Int,
    targetWidthDots: Int,
    maxHeightDots: Int?,
  ): Bitmap =
    SourceFiles.openDescriptor(context, source).use { descriptor ->
      PdfRenderer(descriptor).use { renderer ->
        if (pageIndex < 0 || pageIndex >= renderer.pageCount) {
          throw IOException(
            "Page $pageIndex does not exist: '$source' has ${renderer.pageCount} page(s)."
          )
        }
        renderer.openPage(pageIndex).use { page ->
          var width = targetWidthDots
          var height = maxOf(
            1,
            Math.round(page.height.toFloat() * width / page.width)
          )
          if (maxHeightDots != null && height > maxHeightDots) {
            height = maxHeightDots
            width = maxOf(
              1,
              Math.round(page.width.toFloat() * height / page.height)
            )
          }
          val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
          // PdfRenderer draws only the page's marks and leaves everything else
          // untouched, so the bitmap must start white or the background reads as
          // fully black once it is reduced to one bit per pixel.
          bitmap.eraseColor(Color.WHITE)
          page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
          bitmap
        }
      }
    }
}
