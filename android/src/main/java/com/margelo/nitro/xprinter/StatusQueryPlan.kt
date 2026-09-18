package com.margelo.nitro.xprinter

/**
 * The status queries used to read a printer's current condition, and how to
 * read the answers, once the command language it is speaking is known.
 *
 * Unlike {@link LanguageProbePlan}, these are language-specific: sending the
 * wrong one to a printer speaking the other language gets no meaningful
 * reply, so callers must resolve the language first (see
 * `HybridBluetoothPrinter.readStatus`).
 */
internal object StatusQueryPlan {
  /**
   * ESC/POS `DLE EOT n` — real-time status transmission, processed the moment
   * it arrives rather than queued behind a print job. Each `n` asks about a
   * different subsystem and answers with exactly one byte, so reading a full
   * picture costs three round trips.
   *
   * `n = 2`, offline cause.
   */
  val ESC_POS_OFFLINE_STATUS = byteArrayOf(0x10, 0x04, 0x02)

  /** `n = 3`, error cause. */
  val ESC_POS_ERROR_STATUS = byteArrayOf(0x10, 0x04, 0x03)

  /** `n = 4`, paper roll sensor. */
  val ESC_POS_PAPER_STATUS = byteArrayOf(0x10, 0x04, 0x04)

  /** Every ESC/POS real-time status query answers with a single byte. */
  const val ESC_POS_REPLY_BYTES = 1

  /**
   * TSPL `<ESC>!?` — inquire printer status, answered with a single status
   * *code*, not a bitfield. See {@linkcode Byte.toTsplStatus} for the mapping.
   */
  val TSPL_STATUS_QUERY = byteArrayOf(0x1B, 0x21, 0x3F)

  /** TSPL's status query answers with a single status-code byte. */
  const val TSPL_REPLY_BYTES = 1

  /**
   * How long to wait for a reply to a single status query.
   *
   * Matches {@linkcode LanguageProbePlan.REPLY_TIMEOUT_MS}: these are the same
   * kind of real-time, print-nothing command, so the same margin applies —
   * anything beyond this is a printer that is not going to answer at all.
   */
  const val REPLY_TIMEOUT_MS = 700L
}
