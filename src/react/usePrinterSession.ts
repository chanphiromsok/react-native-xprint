import { useContext } from 'react';
import type { PrinterSession } from '../session/PrinterSession';
import { PrinterContext } from './PrinterContext';

/**
 * Returns the `PrinterSession` supplied to the nearest `PrinterProvider`.
 *
 * Throws rather than returning `undefined` on a missing provider, because a
 * silently-undefined session would surface as "why is nothing happening
 * when I call print()" three files away from the actual mistake. Most apps
 * will not call this directly — `usePrinter` is the everyday hook — but it
 * is exported for the rare screen that needs the session itself, e.g. to
 * pass it to `usePrinterSetup`'s caller after a successful pairing.
 */
export function usePrinterSession(): PrinterSession {
  const session = useContext(PrinterContext);
  if (session === undefined) {
    throw new Error(
      'usePrinterSession() was called outside a <PrinterProvider>. Wrap ' +
        'your app (or the screen that prints) in <PrinterProvider session={...}>.'
    );
  }
  return session;
}
