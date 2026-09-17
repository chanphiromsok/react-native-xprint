const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * Encodes ASCII text into the single-byte code page thermal printers default to.
 * Non-ASCII characters are replaced with `?` rather than silently truncated.
 */
function encodeAscii(text: string): number[] {
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    return code > 0x7f ? 0x3f : code;
  });
}

/** The ESC/POS `ESC @` initialise command, which resets the printer's state. */
export function escPosInit(): ArrayBuffer {
  return Uint8Array.from([ESC, 0x40]).buffer;
}

/**
 * Builds a small ESC/POS test receipt: initialise, print a centered heading and
 * a couple of lines, feed the paper clear of the head, then cut.
 */
export function testReceipt(deviceName: string): ArrayBuffer {
  const bytes = [
    ESC,
    0x40, // initialise printer
    ESC,
    0x61,
    0x01, // center
    ESC,
    0x21,
    0x30, // double width + height
    ...encodeAscii('XPrinter'),
    LF,
    ESC,
    0x21,
    0x00, // back to normal size
    ...encodeAscii('react-native-xprinter'),
    LF,
    ESC,
    0x61,
    0x00, // left align
    LF,
    ...encodeAscii(`Device: ${deviceName}`),
    LF,
    ...encodeAscii(`Printed: ${new Date().toLocaleString()}`),
    LF,
    LF,
    LF,
    LF,
    GS,
    0x56,
    0x42,
    0x00, // partial cut (ignored by printers without a cutter)
  ];

  return Uint8Array.from(bytes).buffer;
}
