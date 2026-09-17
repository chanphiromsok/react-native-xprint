/**
 * The command language a printer is interpreting.
 *
 * Thermal printers are commonly multi-protocol — XPrinter hardware often
 * understands TSPL, EPL, ZPL, CPCL and ESC/POS — but only **one** is active at a
 * time, chosen from the printer's own menu. A job written in any of the others is
 * silently discarded: the connection succeeds, the write succeeds, and nothing
 * comes out.
 */
export type CommandLanguage =
  /** Receipt printers. Binary control codes; content flows top-down. */
  | 'escpos'
  /** Label printers. Line-oriented ASCII on a fixed canvas, CRLF terminated. */
  | 'tspl';
