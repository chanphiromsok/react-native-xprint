import Foundation

/// Reads a printer's ASCII reply as text, keeping only printable characters.
///
/// Replies routinely carry framing bytes — CR, LF, NUL padding — around the
/// part a human wants to read, and a model name with a stray control
/// character in it is worse than one without.
extension Data {
  func toPrintableAscii() -> String {
    let printable = filter { byte in (0x20..<0x7F).contains(byte) }
    return String(decoding: printable, as: UTF8.self)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
