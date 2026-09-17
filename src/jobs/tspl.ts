import type { LabelMedia } from '../types/LabelMedia';

/**
 * Encodes an ASCII TSPL program.
 *
 * TSPL is line-oriented and every line must end with CRLF. Use this to build
 * commands this library does not model, and concatenate the result with raster
 * chunks from {@linkcode PrinterRaster.toTsplBitmap}.
 */
export function tsplProgram(lines: string[]): ArrayBuffer {
  const program = lines.map((line) => `${line}\r\n`).join('');
  const bytes = Array.from(program, (character) => {
    const code = character.charCodeAt(0);
    return code > 0x7f ? 0x3f : code;
  });
  return Uint8Array.from(bytes).buffer;
}

/**
 * The TSPL self-test, which prints the printer's current configuration.
 *
 * Prints a configuration page on a printer in TSPL mode and does nothing on one
 * that is not — useful as a last resort when
 * {@linkcode BluetoothPrinter.detectLanguage} comes back inconclusive.
 */
export function tsplSelfTest(): ArrayBuffer {
  return tsplProgram(['SELFTEST']);
}

/**
 * Builds a calibration target: the canvas outline, centre lines, and a tick
 * every 5 mm along the top and left edges.
 *
 * Print it with the origin offset at zero to see where the printer actually puts
 * the canvas, then read the registration error straight off the paper:
 *
 * - The gap between the paper's edge and the frame is `originOffsetMm`.
 * - A frame edge that does not print means the canvas overhangs the label there.
 * - Where the right edge stops printing is the true `printableWidthMm`.
 * - The centre cross should land on the middle of the label.
 *
 * This beats inferring geometry from a photo that looks slightly wrong, which is
 * how calibration values end up over-fitted to one paper size.
 */
export function tsplCalibrationLabel(
  media: LabelMedia,
  dotsPerMm: number
): ArrayBuffer {
  const width = Math.floor(media.widthMm * dotsPerMm);
  const height = Math.floor(media.heightMm * dotsPerMm);
  const step = Math.floor(5 * dotsPerMm);
  const tick = Math.floor(2 * dotsPerMm);

  const ticks: string[] = [];
  for (let x = step; x < width; x += step) {
    ticks.push(`BAR ${x},0,2,${tick}`);
  }
  for (let y = step; y < height; y += step) {
    ticks.push(`BAR 0,${y},${tick},2`);
  }

  return tsplProgram([
    `SIZE ${media.widthMm} mm,${media.heightMm} mm`,
    'DIRECTION 0',
    'CLS',
    `BOX 0,0,${width - 1},${height - 1},3`,
    `BAR 0,${Math.floor(height / 2)},${width},2`,
    `BAR ${Math.floor(width / 2)},0,2,${height}`,
    ...ticks,
    'TEXT 12,12,"2",0,1,1,"TL"',
    `TEXT 12,${height - 40},"2",0,1,1,"${media.widthMm}x${media.heightMm}"`,
    'PRINT 1,1',
  ]);
}

/**
 * The TSPL media command for the loaded stock.
 *
 * `'printerDefault'` deliberately emits nothing: telling a printer to look for
 * gaps in continuous stock makes it run paper hunting for one, so the printer's
 * own setting wins unless the caller states the stock explicitly.
 */
export function tsplMediaCommands(media: LabelMedia): string[] {
  const separation = media.separationMm ?? 0;
  switch (media.type) {
    case 'printerDefault':
      return [];
    case 'continuous':
      return ['GAP 0 mm,0 mm'];
    case 'gap':
      return [`GAP ${separation} mm,0 mm`];
    case 'blackMark':
      return [`BLINE ${separation} mm,0 mm`];
  }
}
