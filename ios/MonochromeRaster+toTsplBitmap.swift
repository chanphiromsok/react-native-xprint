import Foundation

/// Encodes this raster as a complete TSPL `BITMAP` command.
///
/// The command is `BITMAP x,y,widthBytes,height,mode,<data>` followed by CRLF,
/// where mode 0 overwrites whatever is already on the label canvas.
///
/// TSPL treats a **set** bit as white, which is the opposite of how the
/// raster is stored, so every byte is inverted here.
extension MonochromeRaster {
  func toTsplBitmap(xDots: Int, yDots: Int) -> [UInt8] {
    var output: [UInt8] = []
    output.reserveCapacity(bytes.count + 64)
    output.append(contentsOf: Array("BITMAP \(xDots),\(yDots),\(rowBytes),\(heightDots),0,".utf8))
    output.append(contentsOf: bytes.map { ~$0 })
    output.append(contentsOf: Array("\r\n".utf8))
    return output
  }
}
