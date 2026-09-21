import CoreGraphics
import Foundation
import NitroModules

/// The iOS implementation of `PrinterImageFactory`.
///
/// Decoding and dithering are CPU-bound and can run for hundreds of
/// milliseconds on a full-width image, so they run on their own queue and
/// never touch the main thread.
final class HybridPrinterImageFactory: HybridPrinterImageFactorySpec {
  private let queue = DispatchQueue(label: "com.margelo.nitro.xprinter.image-factory", qos: .userInitiated)

  func rasterize(options: RasterizeOptions) throws -> Promise<(any HybridPrinterRasterSpec)> {
    Promise.parallel(queue) {
      guard options.widthDots >= 1, options.widthDots == options.widthDots.rounded(.down) else {
        throw RuntimeError.error(
          withMessage: "widthDots must be a positive whole number of dots (got \(options.widthDots))."
        )
      }

      // Rasterize a PDF page straight to the final fitted size — see
      // PdfPageRenderer — rather than decoding it like a bitmap image.
      let image: CGImage =
        if try SourceFiles.isPdf(source: options.source) {
          try PdfPageRenderer.render(
            source: options.source,
            pageIndex: options.pageIndex.map { Int($0) } ?? 0,
            targetWidthDots: Int(options.widthDots),
            maxHeightDots: options.maxHeightDots.map { Int($0) },
            trimToContent: options.trimToContent
          )
        } else {
          try SourceImageLoader.load(source: options.source)
        }

      let raster = try MonochromeRasterizer.rasterize(image: image, options: options)
      return HybridPrinterRaster(raster: raster) as any HybridPrinterRasterSpec
    }
  }

  func countPages(source: String) throws -> Promise<Double> {
    Promise.parallel(queue) {
      if try SourceFiles.isPdf(source: source) {
        return Double(try PdfPageRenderer.pageCount(source: source))
      }
      return 1.0
    }
  }
}
