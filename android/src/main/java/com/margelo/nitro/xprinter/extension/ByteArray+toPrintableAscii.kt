package com.margelo.nitro.xprinter.extension

/**
 * Reads a printer's ASCII reply as text, keeping only printable characters.
 *
 * Replies routinely carry framing bytes — CR, LF, NUL padding — around the part
 * a human wants to read, and a model name with a stray control character in it
 * is worse than one without.
 */
internal fun ByteArray.toPrintableAscii(): String =
  filter { byte -> byte in 0x20..<0x7F }
    .toByteArray()
    .toString(Charsets.US_ASCII)
    .trim()
