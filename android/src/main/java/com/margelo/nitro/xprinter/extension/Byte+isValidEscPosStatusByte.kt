package com.margelo.nitro.xprinter.extension

/**
 * Whether this byte is plausibly a genuine ESC/POS real-time status reply,
 * rather than stray data that happened to arrive in its place.
 *
 * Every ESC/POS real-time status byte carries three fixed bits regardless of
 * which query produced it: bit 0 is always 0, bit 1 is always 1, and bit 4 is
 * always 1. A byte that violates that pattern was not emitted by the status
 * machinery — it is noise left over from a previous command, a partial print
 * job the printer echoed, or a printer that does not implement this query at
 * all — so it is treated the same as no reply rather than parsed as one.
 */
internal fun Byte.isValidEscPosStatusByte(): Boolean {
  val value = toInt() and 0xFF
  return (value and FIXED_BITS_MASK) == FIXED_BITS_PATTERN
}

/** Bits 0, 1, 4 and 7 — the positions ESC/POS fixes on every status byte. */
private const val FIXED_BITS_MASK = 0x93

/** bit0=0, bit1=1, bit4=1, bit7=0 — the only value those positions may take. */
private const val FIXED_BITS_PATTERN = 0x12
