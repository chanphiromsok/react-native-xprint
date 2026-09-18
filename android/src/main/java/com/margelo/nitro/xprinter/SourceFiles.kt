package com.margelo.nitro.xprinter

import android.content.Context
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.IOException
import java.io.InputStream
import androidx.core.net.toUri

/**
 * Opens a source reference — a plain path, a `file://` URI, or a `content://`
 * URI — as a stream or a file descriptor, and tells image sources from PDFs.
 */
internal object SourceFiles {
  /** `%PDF` — the header every PDF begins with. */
  private val PDF_MAGIC = byteArrayOf(0x25, 0x50, 0x44, 0x46)

  /**
   * Whether this source is a PDF.
   *
   * Decided by the file's first bytes rather than its extension: a `content://`
   * URI from a picker often carries no usable name, and `printToFileAsync`
   * output has been renamed by callers often enough not to trust the suffix.
   */
  fun isPdf(context: Context, source: String): Boolean =
    openStream(context, source).use { stream ->
      val header = ByteArray(PDF_MAGIC.size)
      val read = stream.read(header)
      read == PDF_MAGIC.size && header.contentEquals(PDF_MAGIC)
    }

  fun openStream(context: Context, source: String): InputStream =
    if (source.startsWith("content://")) {
      context.contentResolver.openInputStream(source.toUri())
        ?: throw IOException("Nothing could be opened at '$source'.")
    } else {
      fileFor(source).inputStream()
    }

  /**
   * A seekable descriptor, which `PdfRenderer` requires — it needs random access
   * and cannot work from a plain stream.
   */
  fun openDescriptor(context: Context, source: String): ParcelFileDescriptor =
    if (source.startsWith("content://")) {
      context.contentResolver.openFileDescriptor(source.toUri(), "r")
        ?: throw IOException("Nothing could be opened at '$source'.")
    } else {
      ParcelFileDescriptor.open(
        fileFor(source),
        ParcelFileDescriptor.MODE_READ_ONLY
      )
    }

  private fun fileFor(source: String): File {
    val path = if (source.startsWith("file://")) {
      source.toUri().path.orEmpty()
    } else {
      source
    }
    val file = File(path)
    if (!file.isFile) {
      throw IOException("There is no file at '${file.absolutePath}'.")
    }
    return file
  }
}
