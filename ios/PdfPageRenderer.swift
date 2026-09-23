import CoreGraphics
import Foundation
import NitroModules

/// Renders PDF pages to images at whatever resolution the printer needs.
enum PdfPageRenderer {
  /// Resolution of the cheap probe render used to find the content's ink
  /// bounds.
  private static let probeWidthPx = 300

  /// Anything darker than this on any channel counts as ink. Comfortably
  /// below 255 so anti-aliased glyph edges are not missed, but far enough
  /// from 255 that vector rendering never trips it on a blank background.
  private static let contentLuminanceThreshold = 250

  /// Probe pixels of slack kept around the detected ink, so a crop does not
  /// clip an anti-aliased edge it only just found. Kept to 1: at the probe's
  /// 300px resolution, each pixel of padding costs a meaningful slice of the
  /// final scale — content that is already small on a thermal label can't
  /// afford to give resolution back to margin it doesn't need.
  private static let contentPaddingPx = 1

  static func pageCount(source: String) throws -> Int {
    let url = try SourceFiles.fileURL(for: source)
    return try SourceFiles.withSecurityScopedAccess(url) {
      guard let document = CGPDFDocument(url as CFURL) else {
        throw RuntimeError.error(withMessage: "Could not open a PDF at '\(source)'.")
      }
      return document.numberOfPages
    }
  }

  /// Renders one page sized to fit `targetWidthDots` wide and, if given,
  /// `maxHeightDots` tall — the same box `MonochromeRasterizer` would
  /// otherwise shrink the image into after the fact.
  ///
  /// Rendering straight to the final size matters: a PDF is vector art, so
  /// rasterizing once at the size the image will actually be keeps text and
  /// barcode bars as crisp as the head can reproduce. Rendering large and
  /// letting the rasterizer scale down again would soften those edges —
  /// twice, once per resample — before the dithering step ever sees them.
  ///
  /// When `trimToContent` is set, the page's own dimensions are not what
  /// gets fitted — its ink is. An HTML-to-PDF page is typically a full sheet
  /// (Letter, A4) regardless of how little content it holds, so fitting the
  /// whole sheet would shrink a short receipt down small, centred in a sea
  /// of margin that scaled down along with it. Cropping to the actual
  /// content first, found by a cheap low-resolution probe render, means the
  /// label fills with content rather than with a shrunken blank page.
  static func render(
    source: String,
    pageIndex: Int,
    targetWidthDots: Int,
    maxHeightDots: Int?,
    trimToContent: Bool
  ) throws -> CGImage {
    let url = try SourceFiles.fileURL(for: source)
    return try SourceFiles.withSecurityScopedAccess(url) {
      guard let document = CGPDFDocument(url as CFURL) else {
        throw RuntimeError.error(withMessage: "Could not open a PDF at '\(source)'.")
      }
      // CGPDFDocument pages are 1-based; the off-by-one here is the single
      // most likely bug in this file.
      guard pageIndex >= 0, pageIndex < document.numberOfPages,
        let page = document.page(at: pageIndex + 1)
      else {
        throw RuntimeError.error(
          withMessage: "Page \(pageIndex) does not exist: '\(source)' has \(document.numberOfPages) page(s)."
        )
      }

      // The box everything below is measured against is the page's crop box
      // *after* its `/Rotate` entry is accounted for — `CGPDFPage` never
      // applies that rotation on its own, unlike Android's `PdfRenderer`.
      // Un-rotating up front means every measurement downstream (the probe,
      // the crop rect, the final fit) can treat the page as a plain
      // upright rectangle.
      let box = rotationNormalizedBox(for: page)
      guard box.width > 0, box.height > 0 else {
        throw RuntimeError.error(withMessage: "Page \(pageIndex) of '\(source)' has an empty page box.")
      }

      let contentPt = trimToContent ? try detectContentBoundsPt(page: page, box: box) : box
      guard contentPt.width > 0, contentPt.height > 0 else {
        throw RuntimeError.error(withMessage: "Page \(pageIndex) of '\(source)' has no usable content area.")
      }
      let contentWidthPt = contentPt.width
      let contentHeightPt = contentPt.height

      var width = targetWidthDots
      var height = max(1, Int((Double(contentHeightPt) * Double(width) / Double(contentWidthPt)).rounded()))
      if let maxHeightDots, height > maxHeightDots {
        height = maxHeightDots
        width = max(1, Int((Double(contentWidthPt) * Double(height) / Double(contentHeightPt)).rounded()))
      }

      guard
        let context = CGContext(
          data: nil,
          width: width,
          height: height,
          bitsPerComponent: 8,
          bytesPerRow: width * 4,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
      else {
        throw RuntimeError.error(withMessage: "Could not allocate a \(width)x\(height) bitmap context.")
      }

      // `drawPDFPage` draws only the page's marks and leaves everything else
      // untouched, so the context must start white or the background reads
      // as fully black once it is reduced to one bit per pixel.
      context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
      context.fill(CGRect(x: 0, y: 0, width: width, height: height))

      applyCropAndFitTransform(to: context, contentPt: contentPt, targetWidth: width, targetHeight: height)
      concatenateRotationCorrection(context, page: page, into: box)
      context.drawPDFPage(page)

      guard let image = context.makeImage() else {
        throw RuntimeError.error(withMessage: "Could not render page \(pageIndex) of '\(source)'.")
      }
      return image
    }
  }

  /// The page's crop box with its `/Rotate` entry folded into the
  /// dimensions (width and height swapped for a 90°/270° rotation), origin
  /// at zero. This is the coordinate space every other function in this
  /// file works in — never the raw, unrotated `getBoxRect(.cropBox)`.
  private static func rotationNormalizedBox(for page: CGPDFPage) -> CGRect {
    let box = page.getBoxRect(.cropBox)
    // `/Rotate` is only required to be a multiple of 90 — it is legally
    // negative (`-90`) or over a full turn (`450`), and producers emit both.
    // Matching the raw value against 90/270 misses those and leaves the box
    // un-swapped while `getDrawingTransform` rotates the content into it
    // anyway, which prints the page anamorphically squashed. Android's
    // `PdfRenderer` normalizes for us; Core Graphics does not.
    switch ((Int(page.rotationAngle) % 360) + 360) % 360 {
    case 90, 270:
      return CGRect(x: 0, y: 0, width: box.height, height: box.width)
    default:
      return CGRect(x: 0, y: 0, width: box.width, height: box.height)
    }
  }

  /// Concatenates the transform that maps the page's actual content
  /// (unrotated PDF space, `/Rotate` not yet applied) into `box` — the
  /// rotation-normalized frame every measurement in this file is taken in.
  ///
  /// Must be concatenated *last*, immediately before `drawPDFPage`: Core
  /// Graphics applies the most-recently-concatenated transform to content
  /// first, so this has to sit closest to the actual draw call, with the
  /// crop-and-fit transform (set up by the caller beforehand) wrapping
  /// around it.
  private static func concatenateRotationCorrection(_ context: CGContext, page: CGPDFPage, into box: CGRect) {
    let transform = page.getDrawingTransform(.cropBox, rect: box, rotate: 0, preserveAspectRatio: false)
    context.concatenate(transform)
  }

  /// Sets up the context's CTM so that drawing the page now crops to
  /// `contentPt` (a sub-rect of the rotation-normalized box passed to
  /// `concatenateRotationCorrection`) and scales it to exactly
  /// `targetWidth`x`targetHeight`, in a single pass — no second resample
  /// softening the result.
  ///
  /// A `CGContext` created this way has an unflipped, y-up, origin-bottom-
  /// left user space — the same convention PDF content space uses — and
  /// its pixel buffer's row 0 already corresponds to the *top* of that user
  /// space. Nothing here needs to correct for orientation; it only needs to
  /// translate `contentPt`'s corner to the origin, then scale to the target
  /// size. That has to happen in that order (translate the *content*, then
  /// scale the translated result) which, because each `translateBy`/
  /// `scaleBy` call transforms content *before* whatever was called
  /// earlier, means `scaleBy` is called first below and `translateBy` last.
  private static func applyCropAndFitTransform(
    to context: CGContext,
    contentPt: CGRect,
    targetWidth: Int,
    targetHeight: Int
  ) {
    context.scaleBy(
      x: CGFloat(targetWidth) / contentPt.width,
      y: CGFloat(targetHeight) / contentPt.height
    )
    context.translateBy(x: -contentPt.origin.x, y: -contentPt.origin.y)
  }

  /// Finds the page's ink, in `box`'s point space, via a cheap low-
  /// resolution render — full-resolution is unnecessary just to locate a
  /// bounding box, and would cost the memory and time of an image this
  /// function immediately throws away.
  ///
  /// A page with no ink at all (a blank page) has nothing to trim to, so it
  /// falls back to the whole box rather than collapsing to a zero-size
  /// crop.
  private static func detectContentBoundsPt(page: CGPDFPage, box: CGRect) throws -> CGRect {
    let probeWidth = probeWidthPx
    let probeHeight = max(1, Int((box.height * CGFloat(probeWidth) / box.width).rounded()))

    guard
      let context = CGContext(
        data: nil,
        width: probeWidth,
        height: probeHeight,
        bitsPerComponent: 8,
        bytesPerRow: probeWidth * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else {
      throw RuntimeError.error(withMessage: "Could not allocate a \(probeWidth)x\(probeHeight) probe context.")
    }
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: probeWidth, height: probeHeight))
    applyCropAndFitTransform(to: context, contentPt: box, targetWidth: probeWidth, targetHeight: probeHeight)
    concatenateRotationCorrection(context, page: page, into: box)
    context.drawPDFPage(page)

    guard let data = context.data else {
      throw RuntimeError.error(withMessage: "Probe context produced no pixel data.")
    }
    let bytesPerRow = context.bytesPerRow
    let buffer = data.bindMemory(to: UInt8.self, capacity: bytesPerRow * probeHeight)

    // minX/minY/maxX/maxY are in probe-pixel, top-down (row 0 = page top)
    // coordinates throughout this function, exactly like the Android probe
    // — true here because `applyCropAndFitTransform` above needs no
    // orientation correction; see its doc comment.
    var minX = probeWidth
    var minY = probeHeight
    var maxX = -1
    var maxY = -1
    for y in 0..<probeHeight {
      let rowOffset = y * bytesPerRow
      for x in 0..<probeWidth {
        let pixelOffset = rowOffset + x * 4
        let red = Int(buffer[pixelOffset])
        let green = Int(buffer[pixelOffset + 1])
        let blue = Int(buffer[pixelOffset + 2])
        if red < contentLuminanceThreshold || green < contentLuminanceThreshold || blue < contentLuminanceThreshold {
          if x < minX { minX = x }
          if x > maxX { maxX = x }
          if y < minY { minY = y }
          if y > maxY { maxY = y }
        }
      }
    }

    if maxX < minX || maxY < minY {
      return box
    }

    // X and Y each get their own points-per-probe-pixel: probeHeight was
    // rounded when it was derived from probeWidth above, so the two axes
    // are only approximately equal, not exactly — using one ratio for both
    // would introduce a small aspect-ratio error into the crop.
    let ptPerProbePxX = box.width / CGFloat(probeWidth)
    let ptPerProbePxY = box.height / CGFloat(probeHeight)
    let left = CGFloat(max(0, minX - contentPaddingPx)) * ptPerProbePxX
    let top = CGFloat(max(0, minY - contentPaddingPx)) * ptPerProbePxY
    // Right/bottom edges are `(clamped_max + 1) * ratio` — the `+ 1` makes
    // the rect cover the ink pixel rather than stop at its top-left corner.
    let right = CGFloat(min(probeWidth - 1, maxX + contentPaddingPx) + 1) * ptPerProbePxX
    let bottom = CGFloat(min(probeHeight - 1, maxY + contentPaddingPx) + 1) * ptPerProbePxY

    // `top`/`bottom` above are measured downward from the box's top edge,
    // matching Android's convention. `box` is y-up from its bottom-left, so
    // the crop rect's origin (its minimum corner) is at `box.height -
    // bottom` from `box.origin.y`, not at `top`.
    return CGRect(
      x: box.origin.x + left,
      y: box.origin.y + box.height - bottom,
      width: right - left,
      height: bottom - top
    )
  }
}
