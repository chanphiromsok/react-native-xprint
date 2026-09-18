import type { SavedPrinter } from './SavedPrinter';

/**
 * Every printer a driver has set up on this device, and which one prints
 * right now.
 *
 * A driver may work from several vans over a week, or share a depot
 * printer with other drivers on the same phone, so `PrinterSession`
 * remembers more than one `SavedPrinter` rather than the single printer
 * it used to. Exactly one of them is ever active — Bluetooth Classic will
 * not reliably hold two RFCOMM sockets open from one phone, and a driver
 * only ever prints to whatever is in front of them — and that one is named
 * by `activeAddress` rather than by its position in `printers`, so
 * reordering the list (which happens on every re-setup, see
 * `upsertPrinter`) can never silently change which printer a driver is
 * about to print to.
 */
export interface PrinterRegistry {
  /** Every printer set up on this device, most recently set up first. */
  printers: SavedPrinter[];
  /** The address of the printer `PrinterSession.print()` will use, if any. */
  activeAddress?: string;
}

/**
 * Adds `printer` to `printers`, or — if its address is already on the
 * list — replaces that entry in place and moves it to the front.
 *
 * Re-running setup for a printer that is already known (a fresh
 * calibration, a language re-probe, a rename) should update that one
 * entry rather than leave a stale duplicate behind it; moving the updated
 * entry to the front keeps "most recently set up first" true for a
 * printer that was just re-configured, the same as it would be for one
 * set up for the first time.
 */
export function upsertPrinter(
  printers: readonly SavedPrinter[],
  printer: SavedPrinter
): SavedPrinter[] {
  return [
    printer,
    ...printers.filter((existing) => existing.address !== printer.address),
  ];
}

/**
 * Removes the printer at `address` from `registry`, promoting a new
 * active printer when the one removed was active.
 *
 * "Most recent remaining" reuses the recency order `printers` is already
 * kept in — the front of the list is whichever printer was most recently
 * set up or re-configured (see `upsertPrinter`), which is the most
 * reasonable default guess for "which printer does this driver want now"
 * once the one they were using is gone. When the removed printer was not
 * the active one, `activeAddress` is left untouched: forgetting a printer
 * a driver is not currently using should not disturb the one they are.
 */
export function removePrinter(
  registry: PrinterRegistry,
  address: string
): PrinterRegistry {
  const printers = registry.printers.filter(
    (printer) => printer.address !== address
  );
  const activeAddress =
    registry.activeAddress === address
      ? printers[0]?.address
      : registry.activeAddress;
  return { printers, activeAddress };
}
