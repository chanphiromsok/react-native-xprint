import Foundation
import ImageIO
import NitroModules

/// Reads a source image into a `CGImage`.
///
/// Bitmap formats only — PDFs go through `PdfPageRenderer`, which can
/// rasterize them at the printer's own resolution instead of a fixed one.
enum SourceImageLoader {
  /// - Parameter source: an absolute file path, a `file://` URI, or a
  ///   security-scoped picker URL.
  /// - Throws: if the image cannot be read or is not a format iOS can
  ///   decode.
  static func load(source: String) throws -> CGImage {
    let url = try SourceFiles.fileURL(for: source)
    return try SourceFiles.withSecurityScopedAccess(url) {
      guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
      else {
        throw RuntimeError.error(
          withMessage: "Could not decode an image from '\(source)'. Check that the file exists and "
            + "is a PNG, JPEG, WebP, HEIC or PDF."
        )
      }
      return image
    }
  }
}
