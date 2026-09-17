package com.margelo.nitro.xprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File
import java.io.IOException

/**
 * Reads a source image into a [Bitmap], whatever shape the caller's reference to
 * it takes.
 */
internal object SourceImageLoader {
  /**
   * @param source an absolute file path, a `file://` URI, or a `content://` URI
   * such as the one an image picker hands back.
   *
   * @throws IOException if the image cannot be read or is not a format Android
   * can decode.
   */
  fun load(context: Context, source: String): Bitmap {
    val bitmap = when {
      source.startsWith("content://") -> decodeContentUri(context, source)
      source.startsWith("file://") -> decodeFile(File(Uri.parse(source).path.orEmpty()))
      else -> decodeFile(File(source))
    }
    return bitmap ?: throw IOException(
      "Could not decode an image from '$source'. Check that the file exists and " +
        "is a PNG, JPEG or WebP."
    )
  }

  private fun decodeContentUri(context: Context, source: String): Bitmap? =
    context.contentResolver.openInputStream(Uri.parse(source)).use { stream ->
      if (stream == null) {
        throw IOException("Nothing could be opened at '$source'.")
      }
      BitmapFactory.decodeStream(stream)
    }

  private fun decodeFile(file: File): Bitmap? {
    if (!file.isFile) {
      throw IOException("There is no file at '${file.absolutePath}'.")
    }
    return BitmapFactory.decodeFile(file.absolutePath)
  }
}
