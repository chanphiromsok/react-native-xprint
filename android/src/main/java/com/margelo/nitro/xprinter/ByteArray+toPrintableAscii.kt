package com.margelo.nitro.xprinter

/**
 * Reads a printer's ASCII reply as text, keeping only printable characters.
 *
 * Replies routinely carry framing bytes — CR, LF, NUL padding — around the part
 * a human wants to read, and a model name with a stray control character in it
 * is worse than one without.
 */
internal fun ByteArray.toPrintableAscii(): String =
  filter { byte -> byte >= 0x20 && byte < 0x7F }
    .toByteArray()
    .toString(Charsets.US_ASCII)
    .trim()
