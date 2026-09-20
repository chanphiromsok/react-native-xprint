import { createContext } from 'react';
import type { PrinterSession } from '../session/PrinterSession';

/**
 * Holds the single `PrinterSession` this app constructed, so `usePrinter` and
 * `usePrinterSession` can reach it without every component along the way
 * having to thread it through as a prop.
 *
 * `undefined` by default rather than a dummy session: a hook reading `null`
 * or a fake session out of context would fail silently far from the actual
 * mistake (forgetting to render `PrinterProvider`). `usePrinterSession`
 * turns that into a clear thrown error instead — see there.
 *
 * This lives in the example app, not the library — `PrinterSession` is
 * framework-agnostic on purpose, and React bindings are a choice each app
 * makes for itself. Copy this folder into your own app and restyle.
 */
export const PrinterContext = createContext<PrinterSession | undefined>(
  undefined
);
