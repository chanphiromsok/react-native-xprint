const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** The ESC/POS `ESC @` initialise command, which resets the printer's state. */
export function escPosInit(): ArrayBuffer {
  return Uint8Array.from([ESC, 0x40]).buffer;
}

/** Feeds `lines` blank lines, to clear the paper of the print head before a tear. */
export function escPosFeed(lines: number): ArrayBuffer {
  return Uint8Array.from(new Array(Math.max(0, lines)).fill(LF)).buffer;
}

/** `GS V 66 0` — partial cut. Printers without a cutter ignore it. */
export function escPosCut(): ArrayBuffer {
  return Uint8Array.from([GS, 0x56, 0x42, 0x00]).buffer;
}

/** Concatenates command chunks into the single buffer sent to the printer. */
export function concatCommands(chunks: ArrayBuffer[]): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}
