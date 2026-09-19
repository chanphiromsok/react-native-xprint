package com.margelo.nitro.xprinter.extension

import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.xprinter.PrinterStatus

/**
 * Interprets this byte array as the three ESC/POS real-time status replies,
 * concatenated in query order — offline status (`n=2`), error status (`n=3`),
 * paper roll sensor (`n=4`) — and maps them to a [com.margelo.nitro.xprinter.PrinterStatus].
 *
 * Each byte is validated independently with [isValidEscPosStatusByte] before
 * its bits are trusted: a printer can answer one query and stay silent (or
 * reply with junk) on another, and a corrupt byte should not be read as "no
 * fault present" — it should read as "no information", which is why every
 * flag below defaults to `false` when its source byte fails validation rather
 * than when the bit itself is unset.
 *
 * ESC/POS's real-time status commands have no bit for a paper jam, so
 * [com.margelo.nitro.xprinter.PrinterStatus.paperJam] is always `false` here — see the type-level note
 * on fields not every language reports.
 */
internal fun ByteArray.toEscPosStatus(): PrinterStatus {
  require(size == 3) {
    "An ESC/POS status reply is three bytes — offline, error, paper — but got $size."
  }

  val offline = this[0].takeIf { it.isValidEscPosStatusByte() }?.let { it.toInt() and 0xFF }
  val error = this[1].takeIf { it.isValidEscPosStatusByte() }?.let { it.toInt() and 0xFF }
  val paper = this[2].takeIf { it.isValidEscPosStatusByte() }?.let { it.toInt() and 0xFF }

  val coverOpen = (offline?.and(OFFLINE_COVER_OPEN) ?: 0) != 0
  // A generic "error" bit distinct from any specific condition below — this is
  // what makes an offline printer `faulted` even when neither cover nor paper
  // sensor explains why.
  val offlineError = (offline?.and(OFFLINE_ERROR) ?: 0) != 0
  val cutterError = (error?.and(ERROR_CUTTER) ?: 0) != 0
  val unrecoverableError = (error?.and(ERROR_UNRECOVERABLE) ?: 0) != 0
  val autoRecoverableError = (error?.and(ERROR_AUTO_RECOVERABLE) ?: 0) != 0
  // These are two-bit fields: both bits set is the documented "true" reading,
  // one bit alone is not.
  // Two sources agree on paper: the dedicated sensor, and the offline byte's
  // "printing stopped because paper ran out". Either is enough — a printer that
  // answered one query but not the other should still report the condition.
  val paperStoppedPrinting = (offline?.and(OFFLINE_PAPER_END) ?: 0) != 0
  val paperOut =
    (paper?.and(PAPER_OUT_MASK) ?: 0) == PAPER_OUT_MASK || paperStoppedPrinting
  val paperNearEnd = (paper?.and(PAPER_NEAR_END_MASK) ?: 0) == PAPER_NEAR_END_MASK

  return PrinterStatus(
    // `online` means "can print right now", not "the socket is usable" — a
    // caller asks in order to decide whether to send a job. An open cover or an
    // empty roll stops a job just as surely as a hardware fault does, so all
    // three take the printer offline. This has to match the TSPL mapping, or
    // the same physical situation would report differently depending on which
    // language the printer happens to be in.
    online = !(unrecoverableError || coverOpen || paperOut),
    paperOut = paperOut,
    paperNearEnd = paperNearEnd,
    coverOpen = coverOpen,
    paperJam = false,
    faulted = offlineError || cutterError || unrecoverableError || autoRecoverableError,
    raw = ArrayBuffer.copy(this)
  )
}

/** Offline status (`n=2`) bit 0x04: cover open. */
private const val OFFLINE_COVER_OPEN = 0x04

/** Offline status (`n=2`) bit 0x20: printing stopped because paper ran out. */
private const val OFFLINE_PAPER_END = 0x20

/** Offline status (`n=2`) bit 0x40: error. */
private const val OFFLINE_ERROR = 0x40

/** Error status (`n=3`) bit 0x08: cutter error. */
private const val ERROR_CUTTER = 0x08

/** Error status (`n=3`) bit 0x20: unrecoverable error. */
private const val ERROR_UNRECOVERABLE = 0x20

/** Error status (`n=3`) bit 0x40: auto-recoverable error. */
private const val ERROR_AUTO_RECOVERABLE = 0x40

/** Paper sensor (`n=4`) bits 0x0C: both set means paper near end. */
private const val PAPER_NEAR_END_MASK = 0x0C

/** Paper sensor (`n=4`) bits 0x60: both set means paper out. */
private const val PAPER_OUT_MASK = 0x60
