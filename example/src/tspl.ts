/**
 * The physical size of the label stock loaded in the printer, in millimetres.
 */
export interface LabelSize {
  widthMm: number;
  heightMm: number;
}

/**
 * Encodes an ASCII TSPL program. TSPL is a line-oriented text protocol, and
 * every line must end with CRLF.
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
 * Builds a TSPL test label sized for the stock actually loaded.
 *
 * `SIZE` is sent because the canvas has to match the media or the job is
 * clipped. `GAP` deliberately is not: the printer's own media setting knows
 * whether the stock is continuous, gap-separated or black-marked, and guessing
 * it wrong misfeeds the labels.
 */
export function testLabel(deviceName: string, size: LabelSize): ArrayBuffer {
  return tsplProgram([
    `SIZE ${size.widthMm} mm,${size.heightMm} mm`,
    'DIRECTION 1',
    'CLS',
    'TEXT 24,32,"3",0,1,1,"XPrinter"',
    'TEXT 24,96,"2",0,1,1,"react-native-xprinter"',
    `TEXT 24,136,"2",0,1,1,"${deviceName}"`,
    'PRINT 1,1',
  ]);
}

/**
 * The TSPL self-test: prints the printer's current configuration.
 *
 * Useful for telling a printer that is in TSPL mode apart from one that is
 * ignoring TSPL, without having to know the label size first.
 */
export function selfTest(): ArrayBuffer {
  return tsplProgram(['SELFTEST']);
}
