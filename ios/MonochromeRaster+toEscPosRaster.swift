import Foundation
import NitroModules

/// Encodes this raster as an ESC/POS `GS v 0` raster bit-image command.
///
/// The header is `1D 76 30 m xL xH yL yH`, where `m = 0` is normal density
/// and the width is given in bytes, the height in dots. A set bit is a black
/// dot, which is how the raster is already stored.
///
/// Height is capped at 65535 dots by the two-byte field; taller images must
/// be split into several commands.
extension MonochromeRaster {
  func toEscPosRaster() throws -> [UInt8] {
    guard heightDots <= 0xFFFF else {
      throw RuntimeError.error(
        withMessage: "An ESC/POS raster command cannot be taller than 65535 dots (got \(heightDots)). "
          + "Scale the image down or split it into slices."
      )
    }
    var output: [UInt8] = []
    output.reserveCapacity(bytes.count + 8)
    output.append(0x1D)
    output.append(0x76)
    output.append(0x30)
    output.append(0x00)
    output.append(UInt8(rowBytes & 0xFF))
    output.append(UInt8((rowBytes >> 8) & 0xFF))
    output.append(UInt8(heightDots & 0xFF))
    output.append(UInt8((heightDots >> 8) & 0xFF))
    output.append(contentsOf: bytes)
    return output
  }
}
