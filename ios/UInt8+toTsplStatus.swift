import Foundation
import NitroModules

/// Interprets this byte as a TSPL `<ESC>!?` status code and maps it to a
/// `PrinterStatus`.
///
/// Unlike ESC/POS, TSPL's status reply is a small closed *enumeration* of
/// codes, not a bitfield to be masked — the printer never reports "head open"
/// and "printing" as independently-set bits, it reports one of a fixed list of
/// combinations the firmware already knows about. Modeling it as a lookup
/// keeps that closed shape explicit instead of inventing bit positions that
/// happen to reproduce the documented codes for the handful of combinations
/// that exist today but would silently misparse an undocumented one.
///
/// "Out of ribbon" has no dedicated field on `PrinterStatus` — a printer that
/// takes ribbon at all is a TSPL-language transfer printer, and that
/// distinction is out of scope for this shape — so it surfaces as
/// `PrinterStatus.faulted` instead of being dropped.
extension UInt8 {
  func toTsplStatus() -> PrinterStatus {
    let code = self
    let raw = ArrayBuffer.copy(of: [code], size: 1)

    /// Builds the result for one enumerated code. `online` is derived, never
    /// passed in: it means "can print right now", so a head-open, jammed, or
    /// out-of-paper condition takes the printer offline. An out-of-ribbon or
    /// unrecognized condition is surfaced via `faulted` but does not by itself
    /// stop a direct thermal print.
    ///
    /// The same derivation appears in the ESC/POS mapping on purpose — the two
    /// must agree, or an open cover would report differently depending only on
    /// which language the printer is in.
    func status(
      coverOpen: Bool = false,
      paperJam: Bool = false,
      paperOut: Bool = false,
      faulted: Bool = false
    ) -> PrinterStatus {
      PrinterStatus(
        online: !(coverOpen || paperJam || paperOut),
        paperOut: paperOut,
        // TSPL's status query has no separate "running low" code — a roll is
        // either present or `paperOut` — so this is always false; see the
        // type-level note on fields not every language reports.
        paperNearEnd: false,
        coverOpen: coverOpen,
        paperJam: paperJam,
        faulted: faulted,
        raw: raw
      )
    }

    switch code {
    case 0x00: return status()
    case 0x01: return status(coverOpen: true)
    case 0x02: return status(paperJam: true)
    case 0x03: return status(coverOpen: true, paperJam: true)
    case 0x04: return status(paperOut: true)
    case 0x05: return status(coverOpen: true, paperOut: true)
    case 0x08: return status(faulted: true) // out of ribbon
    case 0x09: return status(coverOpen: true, faulted: true) // out of ribbon + head open
    case 0x0A: return status(paperJam: true, faulted: true) // out of ribbon + paper jam
    case 0x0B: return status(coverOpen: true, paperJam: true, faulted: true) // out of ribbon + jam + head open
    case 0x10: return status() // paused: not a hardware fault
    case 0x20: return status() // printing: not a hardware fault
    case 0x80: return status(faulted: true) // other error
    // A code this library does not have documentation for. `raw` carries the
    // actual byte so a caller can diagnose it; flagging it as `faulted`
    // rather than silently reporting "normal" is the safer default.
    default: return status(faulted: true)
    }
  }
}
