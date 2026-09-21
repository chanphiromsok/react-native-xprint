import Foundation
import NitroModules

/// Holds rasterized dots natively and hands JS only the encoding it asks
/// for.
///
/// A full-width label is tens of kilobytes of dot data; converting it
/// eagerly into a JS `ArrayBuffer` would pay that cost even when the caller
/// never prints the image.
final class HybridPrinterRaster: HybridPrinterRasterSpec {
  private let raster: MonochromeRaster

  init(raster: MonochromeRaster) {
    self.raster = raster
    super.init()
  }

  var widthDots: Double { Double(raster.widthDots) }
  var heightDots: Double { Double(raster.heightDots) }
  var rowBytes: Double { Double(raster.rowBytes) }

  /// The dot data lives on the native heap, where the JS GC cannot see it.
  var memorySize: Int { raster.bytes.count }

  func toTsplBitmap(xDots: Double, yDots: Double) throws -> ArrayBuffer {
    let bytes = raster.toTsplBitmap(xDots: Int(xDots), yDots: Int(yDots))
    return ArrayBuffer.copy(of: bytes, size: bytes.count)
  }

  func toEscPosRaster() throws -> ArrayBuffer {
    let bytes = try raster.toEscPosRaster()
    return ArrayBuffer.copy(of: bytes, size: bytes.count)
  }
}
