import Foundation

/// The status queries used to read a printer's current condition, and how to
/// read the answers, once the command language it is speaking is known.
///
/// Unlike `LanguageProbePlan`, these are language-specific: sending the wrong
/// one to a printer speaking the other language gets no meaningful reply, so
/// callers must resolve the language first (see
/// `HybridBluetoothPrinter.readStatus`).
enum StatusQueryPlan {
  /// ESC/POS `DLE EOT n` — real-time status transmission, processed the
  /// moment it arrives rather than queued behind a print job. Each `n` asks
  /// about a different subsystem and answers with exactly one byte, so
  /// reading a full picture costs three round trips.
  ///
  /// `n = 2`, offline cause.
  static let escPosOfflineStatus: [UInt8] = [0x10, 0x04, 0x02]

  /// `n = 3`, error cause.
  static let escPosErrorStatus: [UInt8] = [0x10, 0x04, 0x03]

  /// `n = 4`, paper roll sensor.
  static let escPosPaperStatus: [UInt8] = [0x10, 0x04, 0x04]

  /// Every ESC/POS real-time status query answers with a single byte.
  static let escPosReplyBytes = 1

  /// TSPL `<ESC>!?` — inquire printer status, answered with a single status
  /// *code*, not a bitfield. See `UInt8.toTsplStatus()` for the mapping.
  static let tsplStatusQuery: [UInt8] = [0x1B, 0x21, 0x3F]

  /// TSPL's status query answers with a single status-code byte.
  static let tsplReplyBytes = 1

  /// How long to wait for a reply to a single status query.
  ///
  /// Matches `LanguageProbePlan.replyTimeoutMs`: these are the same kind of
  /// real-time, print-nothing command, so the same margin applies — anything
  /// beyond this is a printer that is not going to answer at all.
  ///
  /// - Important: see the same caveat on `LanguageProbePlan.replyTimeoutMs` —
  ///   this is an SPP measurement, not yet confirmed over BLE.
  static let replyTimeoutMs: Int64 = 700
}
