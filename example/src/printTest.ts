import type { BluetoothPrinter, CommandLanguage } from 'react-native-xprint';
import { testReceipt } from './escpos';
import { testLabel } from './tspl';

/**
 * Resolves the language for a connection, probing only when it is not already
 * known, and reports how it was decided so the UI can say so.
 */
export async function resolveLanguage(
  printer: BluetoothPrinter
): Promise<{ language: CommandLanguage; detected: boolean }> {
  if (printer.language != null) {
    return { language: printer.language, detected: false };
  }

  const probe = await printer.detectLanguage();
  if (probe.likely == null) {
    throw new Error(
      'Could not tell which command language this printer is in ' +
        `(ESC/POS answered: ${probe.escPosReplied}, TSPL answered: ${probe.tsplReplied}). ` +
        "Pick one with the ESC/POS or TSPL button — the printer's own menu is the authority."
    );
  }
  return { language: probe.likely, detected: true };
}

/** Prints the built-in text test in whichever language the printer is speaking. */
export async function printTestText(
  printer: BluetoothPrinter,
  language: CommandLanguage,
  deviceName: string
): Promise<void> {
  if (language === 'escpos') {
    await printer.write(testReceipt(deviceName));
    return;
  }
  const media = printer.media;
  if (media == null) {
    throw new Error('Set printer.media before printing a label.');
  }
  await printer.write(testLabel(deviceName, media));
}
