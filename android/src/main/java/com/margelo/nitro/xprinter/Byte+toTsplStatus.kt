package com.margelo.nitro.xprinter

import com.margelo.nitro.core.ArrayBuffer

/**
 * Interprets this byte as a TSPL `<ESC>!?` status code and maps it to a
 * [PrinterStatus].
 *
 * Unlike ESC/POS, TSPL's status reply is a small closed *enumeration* of
 * codes, not a bitfield to be masked — the printer never reports "head open"
 * and "printing" as independently-set bits, it reports one of a fixed list of
 * combinations the firmware already knows about. Modeling it as a lookup
 * keeps that closed shape explicit instead of inventing bit positions that
 * happen to reproduce the documented codes for the handful of combinations
 * that exist today but would silently misparse an undocumented one.
 *
 * "Out of ribbon" has no dedicated field on [PrinterStatus] — a printer that
 * takes ribbon at all is a TSPL-language transfer printer, and that
 * distinction is out of scope for this shape — so it surfaces as
 * [PrinterStatus.faulted] instead of being dropped.
 */
internal fun Byte.toTsplStatus(): PrinterStatus {
  val code = toInt() and 0xFF
  val raw = ArrayBuffer.copy(byteArrayOf(this))

  /**
   * Builds the result for one enumerated code. `online` is derived, never
   * passed in: it means "can print right now", so a head-open, jammed, or
   * out-of-paper condition takes the printer offline. An out-of-ribbon or
   * unrecognized condition is surfaced via [faulted] but does not by itself
   * stop a direct thermal print.
   *
   * The same derivation appears in the ESC/POS mapping on purpose — the two
   * must agree, or an open cover would report differently depending only on
   * which language the printer is in.
   */
  fun status(
    coverOpen: Boolean = false,
    paperJam: Boolean = false,
    paperOut: Boolean = false,
    faulted: Boolean = false
  ): PrinterStatus = PrinterStatus(
    online = !(coverOpen || paperJam || paperOut),
    paperOut = paperOut,
    // TSPL's status query has no separate "running low" code — a roll is
    // either present or `paperOut` — so this is always false; see the
    // type-level note on fields not every language reports.
    paperNearEnd = false,
    coverOpen = coverOpen,
    paperJam = paperJam,
    faulted = faulted,
    raw = raw
  )

  return when (code) {
    0x00 -> status()
    0x01 -> status(coverOpen = true)
    0x02 -> status(paperJam = true)
    0x03 -> status(paperJam = true, coverOpen = true)
    0x04 -> status(paperOut = true)
    0x05 -> status(paperOut = true, coverOpen = true)
    0x08 -> status(faulted = true) // out of ribbon
    0x09 -> status(faulted = true, coverOpen = true) // out of ribbon + head open
    0x0A -> status(faulted = true, paperJam = true) // out of ribbon + paper jam
    0x0B -> status(faulted = true, paperJam = true, coverOpen = true) // out of ribbon + jam + head open
    0x10 -> status() // paused: not a hardware fault
    0x20 -> status() // printing: not a hardware fault
    0x80 -> status(faulted = true) // other error
    // A code this library does not have documentation for. `raw` carries the
    // actual byte so a caller can diagnose it; flagging it as `faulted`
    // rather than silently reporting "normal" is the safer default.
    else -> status(faulted = true)
  }
}
