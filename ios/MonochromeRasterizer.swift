import CoreGraphics
import Foundation
import NitroModules

/// Scales an image to the printer's dot width and reduces it to one bit per
/// pixel.
///
/// Thermal heads can only burn a dot or not, so continuous tone has to go
/// somewhere: either it is thrown away at a threshold, which keeps text and
/// barcodes crisp, or it is diffused into neighboring pixels, which keeps
/// photographs recognizable at the cost of grain.
enum MonochromeRasterizer {
  private static let defaultThreshold = 128

  static func rasterize(image: CGImage, options: RasterizeOptions) throws -> MonochromeRaster {
    let (widthDots, heightDots) = fitWithin(
      imageWidth: image.width,
      imageHeight: image.height,
      widthDots: Int(options.widthDots),
      maxHeightDots: options.maxHeightDots.map { Int($0) }
    )
    var luminance = try luminanceOf(
      scaleAndFlip(image: image, widthDots: widthDots, heightDots: heightDots, options: options),
      invert: options.invert
    )

    let threshold = options.threshold.map { Int($0) } ?? defaultThreshold
    switch options.dithering {
    case .threshold:
      break
    case .floydsteinberg:
      diffuseError(&luminance, width: widthDots, height: heightDots, threshold: threshold)
    @unknown default:
      break
    }

    return MonochromeRaster(
      widthDots: widthDots,
      heightDots: heightDots,
      bytes: pack(luminance, width: widthDots, height: heightDots, threshold: threshold)
    )
  }

  /// Scales to the target size and mirrors in one pass, returning a
  /// straight-alpha-free RGBA8 buffer (row-major, top row first) composited
  /// over white.
  ///
  /// A negative scale factor mirrors along that axis, matching the Android
  /// `Matrix` negative-scale mirror.
  private static func scaleAndFlip(
    image: CGImage,
    widthDots: Int,
    heightDots: Int,
    options: RasterizeOptions
  ) throws -> [UInt8] {
    let bytesPerRow = widthDots * 4
    guard
      let context = CGContext(
        data: nil,
        width: widthDots,
        height: heightDots,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else {
      throw RuntimeError.error(withMessage: "Could not allocate a \(widthDots)x\(heightDots) bitmap context.")
    }

    // The source image may carry transparency; erase to white first so a
    // transparent background does not print as a solid black block once
    // reduced to one bit per pixel. Filling before drawing also means Core
    // Graphics' own source-over compositing does the "over white" blend for
    // us — see `luminanceOf` for why the alpha math there is kept anyway.
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: widthDots, height: heightDots))
    context.interpolationQuality = .high

    // A CGContext created this way is not pre-flipped like a UIKit image
    // context: it already has an unflipped, y-up user space, the same
    // convention `draw(_:in:)` expects to place an image right-side up —
    // row 0 of the buffer below is already the image's true top row with
    // no correction needed. The only transform left to apply is the
    // caller's own mirror request, which — because it operates on an
    // already-correct orientation — matches the Android `Matrix`
    // negative-scale mirror directly.
    context.translateBy(
      x: options.flipHorizontal ? CGFloat(widthDots) : 0,
      y: options.flipVertical ? CGFloat(heightDots) : 0
    )
    context.scaleBy(
      x: options.flipHorizontal ? -1 : 1,
      y: options.flipVertical ? -1 : 1
    )
    context.draw(image, in: CGRect(x: 0, y: 0, width: widthDots, height: heightDots))

    guard let data = context.data else {
      throw RuntimeError.error(withMessage: "Bitmap context produced no pixel data.")
    }
    let buffer = UnsafeBufferPointer(
      start: data.bindMemory(to: UInt8.self, capacity: bytesPerRow * heightDots),
      count: bytesPerRow * heightDots
    )
    return Array(buffer)
  }

  /// The largest size that keeps the aspect ratio and fits inside the given
  /// bounds.
  ///
  /// Width alone is not enough: a tall image scaled to a label's width
  /// overflows a short label, and the overflow is silent — the printer clips
  /// it, or rejects a bitmap taller than its canvas, and nothing comes out.
  /// When a height ceiling is given, height wins and the result comes back
  /// narrower.
  private static func fitWithin(
    imageWidth: Int,
    imageHeight: Int,
    widthDots: Int,
    maxHeightDots: Int?
  ) -> (width: Int, height: Int) {
    let heightAtFullWidth = heightFor(imageWidth: imageWidth, imageHeight: imageHeight, widthDots: widthDots)
    guard let maxHeightDots, heightAtFullWidth > maxHeightDots else {
      return (widthDots, heightAtFullWidth)
    }
    let constrainedWidth = max(
      1,
      Int((Double(imageWidth) * Double(maxHeightDots) / Double(imageHeight)).rounded())
    )
    return (constrainedWidth, heightFor(imageWidth: imageWidth, imageHeight: imageHeight, widthDots: constrainedWidth))
  }

  /// Preserves the aspect ratio, and never rounds a visible image down to
  /// nothing.
  private static func heightFor(imageWidth: Int, imageHeight: Int, widthDots: Int) -> Int {
    max(1, Int((Double(imageHeight) * Double(widthDots) / Double(imageWidth)).rounded()))
  }

  /// Flattens to perceptual gray using the Rec. 601 weights, compositing any
  /// transparency onto white so a transparent background does not print as a
  /// solid black block.
  ///
  /// Deliberately not delegated to a grayscale `CGColorSpace` conversion:
  /// Core Graphics uses different, colour-managed weights there, which would
  /// diverge from Android's Rec. 601 output for identical input.
  private static func luminanceOf(_ pixels: [UInt8], invert: Bool) -> [Int] {
    let count = pixels.count / 4
    var luminance = [Int](repeating: 0, count: count)
    for index in 0..<count {
      let offset = index * 4
      let red = Int(pixels[offset])
      let green = Int(pixels[offset + 1])
      let blue = Int(pixels[offset + 2])
      let alpha = Int(pixels[offset + 3])
      let grey = (red * 299 + green * 587 + blue * 114) / 1000
      let overWhite = (grey * alpha + 255 * (255 - alpha)) / 255
      luminance[index] = invert ? 255 - overWhite : overWhite
    }
    return luminance
  }

  /// Floyd-Steinberg: each pixel's rounding error is pushed onto the
  /// neighbors that have not been decided yet, spreading 7/16 right, and
  /// 3/16, 5/16, 1/16 across the row below.
  ///
  /// Integer division throughout, and the exact traversal order below: a
  /// floating-point version or a different neighbour order gives a visually
  /// similar but byte-different result, which breaks the cross-platform
  /// comparison this rasterizer is checked against.
  private static func diffuseError(_ luminance: inout [Int], width: Int, height: Int, threshold: Int) {
    for y in 0..<height {
      for x in 0..<width {
        let index = y * width + x
        let old = luminance[index]
        let new = old < threshold ? 0 : 255
        luminance[index] = new
        let error = old - new

        if x + 1 < width {
          luminance[index + 1] += error * 7 / 16
        }
        if y + 1 < height {
          if x > 0 {
            luminance[index + width - 1] += error * 3 / 16
          }
          luminance[index + width] += error * 5 / 16
          if x + 1 < width {
            luminance[index + width + 1] += error * 1 / 16
          }
        }
      }
    }
  }

  /// Packs into rows of bytes, most significant bit leftmost, a set bit
  /// meaning black.
  private static func pack(_ luminance: [Int], width: Int, height: Int, threshold: Int) -> [UInt8] {
    let rowBytes = (width + 7) / 8
    var packed = [UInt8](repeating: 0, count: rowBytes * height)

    for y in 0..<height {
      for x in 0..<width {
        if luminance[y * width + x] >= threshold {
          continue // white: leave the bit clear
        }
        let target = y * rowBytes + (x / 8)
        packed[target] |= UInt8(0x80 >> (x % 8))
      }
    }
    return packed
  }
}
