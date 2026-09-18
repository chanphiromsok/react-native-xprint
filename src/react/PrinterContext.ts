import { createContext } from 'react';
import type { PrinterSession } from '../session/PrinterSession';

/**
 * Holds the single `PrinterSession` an app constructed, so `usePrinter` and
 * `usePrinterSession` can reach it without every component along the way
 * having to thread it through as a prop.
 *
 * `undefined` by default rather than a dummy session: a hook reading `null`
 * or a fake session out of context would fail silently far from the actual
 * mistake (forgetting to render `PrinterProvider`). `usePrinterSession`
 * turns that into a clear thrown error instead — see there.
 */
export const PrinterContext = createContext<PrinterSession | undefined>(
  undefined
);
