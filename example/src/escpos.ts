import { concatCommands, escPosCut, escPosInit } from 'react-native-xprinter';

const ESC = 0x1b;
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

/**
 * An ESC/POS test receipt: a centred heading, a couple of lines, enough feed to
 * clear the head, then a cut.
 *
 * Demo content — the library provides the primitives, the app composes the job.
 */
export function testReceipt(deviceName: string): ArrayBuffer {
  const body = [
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
  ];

  return concatCommands([
    escPosInit(),
    Uint8Array.from(body).buffer,
    escPosCut(),
  ]);
}
