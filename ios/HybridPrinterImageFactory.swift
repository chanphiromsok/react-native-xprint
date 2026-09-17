import Foundation
import NitroModules

/// The iOS implementation of `PrinterImageFactory`.
///
/// Rasterizing is platform-independent, but there is no way to send the result
/// to a Bluetooth Classic printer from iOS, so this ships alongside the rest of
/// the Android-only surface rather than as a half-usable capability.
final class HybridPrinterImageFactory: HybridPrinterImageFactorySpec {
  func rasterize(options: RasterizeOptions) throws -> Promise<(any HybridPrinterRasterSpec)> {
    .rejected(withError: UnsupportedPlatformError.bluetoothClassic)
  }
}
