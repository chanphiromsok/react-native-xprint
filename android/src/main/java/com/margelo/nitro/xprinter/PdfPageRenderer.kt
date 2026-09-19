package com.margelo.nitro.xprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import java.io.IOException
import kotlin.math.roundToInt
import androidx.core.graphics.createBitmap

/**
 * Renders PDF pages to bitmaps at whatever resolution the printer needs.
 */
internal object PdfPageRenderer {
  /** Resolution of the cheap probe render used to find the content's ink bounds. */
  private const val PROBE_WIDTH_PX = 300

  /**
   * Anything darker than this on any channel counts as ink. Comfortably below
   * 255 so anti-aliased glyph edges are not missed, but far enough from 255
   * that JPEG-free vector rendering never trips it on a blank background.
   */
  private const val CONTENT_LUMINANCE_THRESHOLD = 250

  /** Probe pixels of slack kept around the detected ink, so a crop does not
   *  clip an anti-aliased edge it only just found. Kept to 1: at the probe's
   *  300px resolution, each pixel of padding costs a meaningful slice of the
   *  final scale — content that is already small on a thermal label can't
   *  afford to give resolution back to margin it doesn't need. */
  private const val CONTENT_PADDING_PX = 1

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
   * When [trimToContent] is set, the page's own dimensions are not what gets
   * fitted — its ink is. An HTML-to-PDF page is typically a full sheet (Letter,
   * A4) regardless of how little content it holds, so fitting the whole sheet
   * would shrink a short receipt down small, centred in a sea of margin that
   * scaled down along with it. Cropping to the actual content first, found by
   * a cheap low-resolution probe render, means the label fills with content
   * rather than with a shrunken blank page.
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
    trimToContent: Boolean,
  ): Bitmap =
    SourceFiles.openDescriptor(context, source).use { descriptor ->
      PdfRenderer(descriptor).use { renderer ->
        if (pageIndex < 0 || pageIndex >= renderer.pageCount) {
          throw IOException(
            "Page $pageIndex does not exist: '$source' has ${renderer.pageCount} page(s)."
          )
        }
        renderer.openPage(pageIndex).use { page ->
          val contentPt = if (trimToContent) {
            detectContentBoundsPt(page)
          } else {
            RectF(0f, 0f, page.width.toFloat(), page.height.toFloat())
          }
          val contentWidthPt = contentPt.width()
          val contentHeightPt = contentPt.height()

          var width = targetWidthDots
          var height = maxOf(
            1,
            (contentHeightPt * width / contentWidthPt).roundToInt()
          )
          if (maxHeightDots != null && height > maxHeightDots) {
            height = maxHeightDots
            width = maxOf(
              1,
              (contentWidthPt * height / contentHeightPt).roundToInt()
            )
          }
          val bitmap = createBitmap(width, height)
          // PdfRenderer draws only the page's marks and leaves everything else
          // untouched, so the bitmap must start white or the background reads as
          // fully black once it is reduced to one bit per pixel.
          bitmap.eraseColor(Color.WHITE)
          // Translating the crop's corner to the origin and scaling to the
          // final size in one matrix means the crop and the fit both happen in
          // this single render pass — no second resample softening the result.
          val matrix = Matrix().apply {
            postTranslate(-contentPt.left, -contentPt.top)
            postScale(width / contentWidthPt, height / contentHeightPt)
          }
          page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
          bitmap
        }
      }
    }

  /**
   * Finds the page's ink, in PDF point space, via a cheap low-resolution
   * render — full-resolution is unnecessary just to locate a bounding box,
   * and would cost the memory and time of a bitmap this function immediately
   * throws away.
   *
   * A page with no ink at all (a blank page) has nothing to trim to, so it
   * falls back to the whole page rather than collapsing to a zero-size crop.
   */
  private fun detectContentBoundsPt(page: PdfRenderer.Page): RectF {
    val probeWidth = PROBE_WIDTH_PX
    val probeHeight = maxOf(
      1,
      (page.height.toFloat() * probeWidth / page.width).roundToInt()
    )
    val probe = createBitmap(probeWidth, probeHeight)
    probe.eraseColor(Color.WHITE)
    page.render(probe, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)

    val pixels = IntArray(probeWidth * probeHeight)
    probe.getPixels(pixels, 0, probeWidth, 0, 0, probeWidth, probeHeight)
    probe.recycle()

    var minX = probeWidth
    var minY = probeHeight
    var maxX = -1
    var maxY = -1
    for (y in 0 until probeHeight) {
      val rowOffset = y * probeWidth
      for (x in 0 until probeWidth) {
        val pixel = pixels[rowOffset + x]
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        if (r < CONTENT_LUMINANCE_THRESHOLD ||
          g < CONTENT_LUMINANCE_THRESHOLD ||
          b < CONTENT_LUMINANCE_THRESHOLD
        ) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return RectF(0f, 0f, page.width.toFloat(), page.height.toFloat())
    }

    // X and Y each get their own points-per-probe-pixel: probeHeight was
    // rounded when it was derived from probeWidth above, so the two axes are
    // only approximately equal, not exactly — using one ratio for both would
    // introduce a small aspect-ratio error into the crop.
    val ptPerProbePxX = page.width.toFloat() / probeWidth
    val ptPerProbePxY = page.height.toFloat() / probeHeight
    val left = maxOf(0, minX - CONTENT_PADDING_PX) * ptPerProbePxX
    val top = maxOf(0, minY - CONTENT_PADDING_PX) * ptPerProbePxY
    val right = (minOf(probeWidth - 1, maxX + CONTENT_PADDING_PX) + 1) * ptPerProbePxX
    val bottom = (minOf(probeHeight - 1, maxY + CONTENT_PADDING_PX) + 1) * ptPerProbePxY
    return RectF(left, top, right, bottom)
  }
}
