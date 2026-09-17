package com.margelo.nitro.xprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.IOException

/**
 * Reads a source image into a [Bitmap].
 *
 * Bitmap formats only — PDFs go through [PdfPageRenderer], which can rasterize
 * them at the printer's own resolution instead of a fixed one.
 */
internal object SourceImageLoader {
  /**
   * @param source an absolute file path, a `file://` URI, or a `content://` URI
   * such as the one an image picker hands back.
   *
   * @throws IOException if the image cannot be read or is not a format Android
   * can decode.
   */
  fun load(context: Context, source: String): Bitmap =
    SourceFiles.openStream(context, source).use { stream ->
      BitmapFactory.decodeStream(stream)
    } ?: throw IOException(
      "Could not decode an image from '$source'. Check that the file exists and " +
        "is a PNG, JPEG, WebP or PDF."
    )
}
