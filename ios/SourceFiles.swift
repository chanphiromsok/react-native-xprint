import Foundation
import NitroModules

/// Resolves a source reference — a plain path, a `file://` URI, or a
/// security-scoped URL from a document/photo picker — to a file URL, and
/// tells image sources from PDFs.
enum SourceFiles {
  /// `%PDF` — the header every PDF begins with.
  private static let pdfMagic: [UInt8] = [0x25, 0x50, 0x44, 0x46]

  /// Whether this source is a PDF.
  ///
  /// Decided by the file's first bytes rather than its extension: a picker
  /// URL often carries no usable name, and `printToFileAsync` output has been
  /// renamed by callers often enough not to trust the suffix.
  static func isPdf(source: String) throws -> Bool {
    let url = try fileURL(for: source)
    return try withSecurityScopedAccess(url) {
      guard let handle = FileHandle(forReadingAtPath: url.path) else {
        throw RuntimeError.error(withMessage: "Nothing could be opened at '\(source)'.")
      }
      defer { handle.closeFile() }
      let header = handle.readData(ofLength: pdfMagic.count)
      return header.count == pdfMagic.count && Array(header) == pdfMagic
    }
  }

  /// Resolves `source` to a readable file URL.
  ///
  /// - Note: `ph://` (Photos library) sources are rejected rather than
  ///   supported. Resolving one needs `PHImageManager` and a photo-library
  ///   permission this library otherwise has no reason to ask for — copy the
  ///   asset to a temporary file first and pass that path instead.
  static func fileURL(for source: String) throws -> URL {
    if source.hasPrefix("ph://") {
      throw RuntimeError.error(
        withMessage: "Photos library sources ('ph://') are not supported. "
          + "Copy the asset to a temporary file and pass that path instead."
      )
    }

    let url: URL
    if source.hasPrefix("file://") {
      guard let parsed = URL(string: source) else {
        throw RuntimeError.error(withMessage: "'\(source)' is not a valid file URL.")
      }
      url = parsed
    } else {
      url = URL(fileURLWithPath: source)
    }

    let reachable = withSecurityScopedAccess(url) {
      (try? url.checkResourceIsReachable()) ?? false
    }
    guard reachable else {
      throw RuntimeError.error(withMessage: "There is no file at '\(url.path)'.")
    }
    return url
  }

  /// Runs `body` with `url` accessible, wrapping it in
  /// `startAccessingSecurityScopedResource()` / `stopAccessingSecurityScopedResource()`.
  ///
  /// A plain path or a `file://` URL the app already owns does not need
  /// security scoping — `startAccessingSecurityScopedResource()` is a no-op
  /// and returns `false` for those, which is safe to ignore. A URL handed
  /// back by `UIDocumentPickerViewController` does need it, or the read
  /// fails with a permissions error that looks like a missing file.
  static func withSecurityScopedAccess<T>(_ url: URL, _ body: () throws -> T) rethrows -> T {
    let didStart = url.startAccessingSecurityScopedResource()
    defer {
      if didStart {
        url.stopAccessingSecurityScopedResource()
      }
    }
    return try body()
  }
}
