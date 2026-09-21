import Foundation

/// The status queries used to work out which command language a printer is
/// interpreting, and how to read the answers.
///
/// Both are *status* commands rather than print commands, so a printer that
/// understands one answers on the wire instead of on paper.
enum LanguageProbePlan {
  /// ESC/POS `DLE EOT 1` — real-time printer status.
  ///
  /// Processed the moment it arrives, ahead of any queued job, and answers
  /// with a single byte. On a TSPL printer these three bytes land in the line
  /// buffer and are discarded by the CRLF that opens the TSPL probe.
  static let escPosStatus: [UInt8] = [0x10, 0x04, 0x01]

  /// TSPL `~!T` — inquire model name, answered in ASCII.
  ///
  /// The leading CRLF terminates whatever the ESC/POS probe left in the line
  /// buffer, so this command parses cleanly.
  ///
  /// Sent only after ESC/POS stays silent: an ESC/POS printer has no idea
  /// what `~!T` means and would print it as text.
  static let tsplModelQuery: [UInt8] = Array("\r\n~!T\r\n".utf8)

  /// One status byte is all ESC/POS returns.
  static let escPosReplyBytes = 1

  /// Model names are short, but leave room for firmware strings some models
  /// append.
  static let tsplReplyBytes = 64

  /// How long to wait for a reply.
  ///
  /// A real-time status command answers within a few milliseconds over
  /// RFCOMM; anything beyond this is a printer that is not going to answer
  /// at all.
  ///
  /// - Important: this figure is an SPP measurement. BLE adds at least one
  ///   connection-interval round trip on top of it; see
  ///   `docs/ios-implementation-spec.md` §8. Re-measure on real hardware
  ///   before trusting it on iOS.
  static let replyTimeoutMs: Int64 = 700
}
