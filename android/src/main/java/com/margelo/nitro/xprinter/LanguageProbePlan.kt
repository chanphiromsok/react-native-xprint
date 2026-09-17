package com.margelo.nitro.xprinter

/**
 * The status queries used to work out which command language a printer is
 * interpreting, and how to read the answers.
 *
 * Both are *status* commands rather than print commands, so a printer that
 * understands one answers on the wire instead of on paper.
 */
internal object LanguageProbePlan {
  /**
   * ESC/POS `DLE EOT 1` — real-time printer status.
   *
   * Processed the moment it arrives, ahead of any queued job, and answers with a
   * single byte. On a TSPL printer these three bytes land in the line buffer and
   * are discarded by the CRLF that opens the TSPL probe.
   */
  val ESC_POS_STATUS = byteArrayOf(0x10, 0x04, 0x01)

  /**
   * TSPL `~!T` — inquire model name, answered in ASCII.
   *
   * The leading CRLF terminates whatever the ESC/POS probe left in the line
   * buffer, so this command parses cleanly.
   *
   * Sent only after ESC/POS stays silent: an ESC/POS printer has no idea what
   * `~!T` means and would print it as text.
   */
  val TSPL_MODEL_QUERY = "\r\n~!T\r\n".toByteArray(Charsets.US_ASCII)

  /** One status byte is all ESC/POS returns. */
  const val ESC_POS_REPLY_BYTES = 1

  /** Model names are short, but leave room for firmware strings some models append. */
  const val TSPL_REPLY_BYTES = 64

  /**
   * How long to wait for a reply.
   *
   * A real-time status command answers within a few milliseconds over RFCOMM;
   * anything beyond this is a printer that is not going to answer at all.
   */
  const val REPLY_TIMEOUT_MS = 700L
}
