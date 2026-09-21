import Foundation
import NitroModules

/// Offline status (`n=2`) bit 0x04: cover open.
private let offlineCoverOpen: UInt8 = 0x04

/// Offline status (`n=2`) bit 0x20: printing stopped because paper ran out.
private let offlinePaperEnd: UInt8 = 0x20

/// Offline status (`n=2`) bit 0x40: error.
private let offlineError: UInt8 = 0x40

/// Error status (`n=3`) bit 0x08: cutter error.
private let errorCutter: UInt8 = 0x08

/// Error status (`n=3`) bit 0x20: unrecoverable error.
private let errorUnrecoverable: UInt8 = 0x20

/// Error status (`n=3`) bit 0x40: auto-recoverable error.
private let errorAutoRecoverable: UInt8 = 0x40

/// Paper sensor (`n=4`) bits 0x0C: both set means paper near end.
private let paperNearEndMask: UInt8 = 0x0C

/// Paper sensor (`n=4`) bits 0x60: both set means paper out.
private let paperOutMask: UInt8 = 0x60

/// Interprets this data as the three ESC/POS real-time status replies,
/// concatenated in query order — offline status (`n=2`), error status (`n=3`),
/// paper roll sensor (`n=4`) — and maps them to a `PrinterStatus`.
///
/// Each byte is validated independently with `isValidEscPosStatusByte()`
/// before its bits are trusted: a printer can answer one query and stay
/// silent (or reply with junk) on another, and a corrupt byte should not be
/// read as "no fault present" — it should read as "no information", which is
/// why every flag below defaults to `false` when its source byte fails
/// validation rather than when the bit itself is unset.
///
/// ESC/POS's real-time status commands have no bit for a paper jam, so
/// `PrinterStatus.paperJam` is always `false` here — see the type-level note
/// on fields not every language reports.
extension Data {
  func toEscPosStatus() throws -> PrinterStatus {
    guard count == 3 else {
      throw RuntimeError.error(
        withMessage: "An ESC/POS status reply is three bytes — offline, error, paper — but got \(count)."
      )
    }

    let bytes = [UInt8](self)
    let offline = bytes[0].isValidEscPosStatusByte() ? bytes[0] : nil
    let error = bytes[1].isValidEscPosStatusByte() ? bytes[1] : nil
    let paper = bytes[2].isValidEscPosStatusByte() ? bytes[2] : nil

    let coverOpen = ((offline ?? 0) & offlineCoverOpen) != 0
    // A generic "error" bit distinct from any specific condition below — this
    // is what makes an offline printer `faulted` even when neither cover nor
    // paper sensor explains why.
    let hasOfflineError = ((offline ?? 0) & offlineError) != 0
    let cutterError = ((error ?? 0) & errorCutter) != 0
    let unrecoverableError = ((error ?? 0) & errorUnrecoverable) != 0
    let autoRecoverableError = ((error ?? 0) & errorAutoRecoverable) != 0
    // These are two-bit fields: both bits set is the documented "true"
    // reading, one bit alone is not.
    // Two sources agree on paper: the dedicated sensor, and the offline
    // byte's "printing stopped because paper ran out". Either is enough — a
    // printer that answered one query but not the other should still report
    // the condition.
    let paperStoppedPrinting = ((offline ?? 0) & offlinePaperEnd) != 0
    let paperOut = ((paper ?? 0) & paperOutMask) == paperOutMask || paperStoppedPrinting
    let paperNearEnd = ((paper ?? 0) & paperNearEndMask) == paperNearEndMask

    return PrinterStatus(
      // `online` means "can print right now", not "the socket is usable" — a
      // caller asks in order to decide whether to send a job. An open cover
      // or an empty roll stops a job just as surely as a hardware fault does,
      // so all three take the printer offline. This has to match the TSPL
      // mapping, or the same physical situation would report differently
      // depending on which language the printer happens to be in.
      online: !(unrecoverableError || coverOpen || paperOut),
      paperOut: paperOut,
      paperNearEnd: paperNearEnd,
      coverOpen: coverOpen,
      paperJam: false,
      faulted: hasOfflineError || cutterError || unrecoverableError || autoRecoverableError,
      raw: ArrayBuffer.copy(of: bytes, size: bytes.count)
    )
  }
}
