import { PrinterImages } from '../PrinterImages';
import type { BluetoothPrinter } from '../specs/BluetoothPrinter.nitro';
import type { PrinterRaster } from '../specs/PrinterRaster.nitro';
import type { Alignment } from '../types/Alignment';
import type { LabelMedia } from '../types/LabelMedia';
import { concatCommands, escPosFeed, escPosInit } from './escpos';
import { DEFAULT_IMAGE_JOB, type ImageJobOptions } from './ImageJobOptions';
import { tsplMediaCommands, tsplProgram } from './tspl';

/** Where an image of `imageDots` sits inside a content area `availableDots` wide. */
function alignedX(
  align: Alignment,
  availableDots: number,
  imageDots: number
): number {
  switch (align) {
    case 'left':
      return 0;
    case 'right':
      return availableDots - imageDots;
    case 'center':
      return Math.floor((availableDots - imageDots) / 2);
  }
}

function requireMedia(printer: BluetoothPrinter): LabelMedia {
  const media = printer.media;
  if (media == null) {
    throw new Error(
      'No label stock configured. Set printer.media to the size loaded, e.g. ' +
        "{ widthMm: 70, heightMm: 80, type: 'printerDefault' }."
    );
  }
  return media;
}

/**
 * Rasterizes an image and prints it as a label, sized and positioned from the
 * printer's own media and calibration.
 *
 * ```ts
 * await printImageAsLabel(printer, 'file:///path/to/invoice.png');
 * ```
 *
 * Centred with a 2 mm edge by default. Changing the paper is one assignment to
 * `printer.media` and no call site moves.
 */
export async function printImageAsLabel(
  printer: BluetoothPrinter,
  source: string,
  overrides: Partial<ImageJobOptions> = {},
  copies: number = 1
): Promise<void> {
  const options = { ...DEFAULT_IMAGE_JOB, ...overrides };
  const media = requireMedia(printer);
  const calibration = printer.calibration;
  const dotsPerMm = calibration.dotsPerMm;

  // The canvas always matches the paper. TSPL anchors it at the printer's
  // origin, so a canvas smaller than the paper sits in the corner — content is
  // centred by placing it, not by shrinking the canvas.
  const paperWidthDots = Math.floor(media.widthMm * dotsPerMm);
  const paperHeightDots = Math.floor(media.heightMm * dotsPerMm);
  const marginDots = Math.floor(options.marginMm * dotsPerMm);
  const headWidthDots = Math.floor(calibration.printableWidthMm * dotsPerMm);
  const originXDots = Math.round(calibration.originOffsetMm.x * dotsPerMm);
  const originYDots = Math.round(calibration.originOffsetMm.y * dotsPerMm);

  /*
   * The widest strip that can actually be centred on the paper.
   *
   * The printable area is inset from the paper's left edge, so it is not centred
   * on the paper: on 80 mm stock a head that starts at 2 mm and runs 72 mm
   * covers 2-74 mm, whose middle is 38 mm rather than 40 mm. Content centred on
   * the paper past this width runs off the head's right edge and is silently
   * clipped.
   */
  const centrableWidthDots = Math.min(
    paperWidthDots - originXDots * 2,
    (originXDots + headWidthDots) * 2 - paperWidthDots
  );

  const contentWidthDots = Math.min(
    options.contentSizeMm == null
      ? paperWidthDots - marginDots * 2
      : Math.floor(options.contentSizeMm.widthMm * dotsPerMm),
    centrableWidthDots
  );
  const contentHeightDots =
    options.contentSizeMm == null
      ? paperHeightDots - marginDots * 2
      : Math.floor(options.contentSizeMm.heightMm * dotsPerMm);
  const contentXDots = Math.floor((paperWidthDots - contentWidthDots) / 2);
  const contentYDots = Math.floor((paperHeightDots - contentHeightDots) / 2);

  const raster = await PrinterImages.rasterize({
    source,
    widthDots: contentWidthDots,
    // Fit the height too. Scaling to width alone overflows a short content area,
    // and the overflow is silent: the printer clips it or refuses the bitmap.
    maxHeightDots: contentHeightDots,
    dithering: options.dithering,
    invert: options.invert,
    flipHorizontal: calibration.flipHorizontal,
    flipVertical: calibration.flipVertical,
  });

  await printer.write(
    concatCommands([
      tsplProgram([
        `SIZE ${media.widthMm} mm,${media.heightMm} mm`,
        ...tsplMediaCommands(media),
        `DIRECTION ${calibration.direction === 'rotated180' ? 1 : 0}`,
        'CLS',
      ]),
      placedBitmap(raster, {
        contentXDots,
        contentYDots,
        contentWidthDots,
        contentHeightDots,
        align: options.align,
        originXDots,
        originYDots,
      }),
      tsplProgram([`PRINT ${copies},1`]),
    ])
  );
}

function placedBitmap(
  raster: PrinterRaster,
  layout: {
    contentXDots: number;
    contentYDots: number;
    contentWidthDots: number;
    contentHeightDots: number;
    align: Alignment;
    originXDots: number;
    originYDots: number;
  }
): ArrayBuffer {
  const x =
    layout.contentXDots +
    alignedX(layout.align, layout.contentWidthDots, raster.widthDots) -
    layout.originXDots;
  const y =
    layout.contentYDots +
    Math.floor((layout.contentHeightDots - raster.heightDots) / 2) -
    layout.originYDots;

  return raster.toTsplBitmap(Math.max(0, x), Math.max(0, y));
}

/**
 * Rasterizes an image and prints it as an ESC/POS raster bit image, scaled to
 * the printer's printable width.
 */
export async function printImageAsReceipt(
  printer: BluetoothPrinter,
  source: string,
  overrides: Partial<ImageJobOptions> = {}
): Promise<void> {
  const options = { ...DEFAULT_IMAGE_JOB, ...overrides };
  const calibration = printer.calibration;
  const raster = await PrinterImages.rasterize({
    source,
    widthDots: Math.floor(calibration.printableWidthMm * calibration.dotsPerMm),
    dithering: options.dithering,
    invert: options.invert,
    flipHorizontal: calibration.flipHorizontal,
    flipVertical: calibration.flipVertical,
  });

  await printer.write(
    concatCommands([escPosInit(), raster.toEscPosRaster(), escPosFeed(4)])
  );
}
