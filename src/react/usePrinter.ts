import { useCallback, useSyncExternalStore } from 'react';
import type { PrintJob } from '../session/PrintJob';
import type { PrintOptions } from '../session/PrintOptions';
import type { PrintOutcome } from '../session/PrintOutcome';
import type { PrinterConnectionState } from '../session/PrinterConnectionState';
import type { PrinterProblem } from '../errors/PrinterProblem';
import type { SavedPrinter } from '../session/SavedPrinter';
import { usePrinterSession } from './usePrinterSession';

/**
 * The read model and actions a printer-aware screen needs, without ever
 * touching `PrinterSession` imperatively.
 *
 * This mirrors `PrinterSession`'s own getters and methods deliberately —
 * see `usePrinter` for why each field is read the way it is — rather than
 * inventing a different shape for React. A driver-facing app should be able
 * to read this doc comment and `PrinterSession`'s side by side and see the
 * same contract.
 */
export interface UsePrinterResult {
  state: PrinterConnectionState;
  printers: readonly SavedPrinter[];
  active: SavedPrinter | undefined;
  problem: PrinterProblem | undefined;
  pending: readonly PrintJob[];
  print(source: string, options?: PrintOptions): Promise<PrintOutcome>;
  connect(): Promise<void>;
  select(address: string): Promise<void>;
  forget(address?: string): Promise<void>;
  flush(): Promise<void>;
}

/**
 * Subscribes a component to the `PrinterSession` from the nearest
 * `PrinterProvider` and re-renders it whenever the session's state,
 * printers, active printer, problem, or pending queue changes.
 *
 * **Why one `useSyncExternalStore` call per field, not one call returning a
 * built object:** `useSyncExternalStore` decides whether to re-render by
 * comparing what `getSnapshot` returns across renders using `Object.is`. A
 * `getSnapshot` that does `() => ({ state: session.state, printers:
 * session.printers, ... })` would allocate a new object on every call —
 * including the calls React makes just to check whether anything changed —
 * so the identity comparison would always fail and React would re-render in
 * an infinite loop. Calling the hook once per field instead means each
 * `getSnapshot` returns exactly what `PrinterSession`'s own getter returns,
 * and that is safe to compare by identity because of how `PrinterSession`
 * is written: it only ever reassigns `currentState` / `currentPrinters` /
 * `currentProblem` / the queue's job array when that piece of data actually
 * changes (see `setState`, `persistRegistry`, `persistPrinterUpdate` in
 * `PrinterSession`), so the same unchanged reference is returned between
 * notifications and `useSyncExternalStore` correctly sees "nothing to do."
 *
 * All five subscriptions share one `subscribe` function, memoized on the
 * session so it is not rebuilt (and re-subscribed) on every render.
 */
export function usePrinter(): UsePrinterResult {
  const session = usePrinterSession();

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) =>
      session.onChange(onStoreChange),
    [session]
  );

  const getState = useCallback(
    (): PrinterConnectionState => session.state,
    [session]
  );
  const getPrinters = useCallback(
    (): readonly SavedPrinter[] => session.printers,
    [session]
  );
  const getActive = useCallback(
    (): SavedPrinter | undefined => session.active,
    [session]
  );
  const getProblem = useCallback(
    (): PrinterProblem | undefined => session.problem,
    [session]
  );
  const getPending = useCallback(
    (): readonly PrintJob[] => session.pending,
    [session]
  );

  const state = useSyncExternalStore(subscribe, getState, getState);
  const printers = useSyncExternalStore(subscribe, getPrinters, getPrinters);
  const active = useSyncExternalStore(subscribe, getActive, getActive);
  const problem = useSyncExternalStore(subscribe, getProblem, getProblem);
  const pending = useSyncExternalStore(subscribe, getPending, getPending);

  const print = useCallback(
    (source: string, options?: PrintOptions): Promise<PrintOutcome> =>
      session.print(source, options),
    [session]
  );
  const connect = useCallback(
    (): Promise<void> => session.connect(),
    [session]
  );
  const select = useCallback(
    (address: string): Promise<void> => session.select(address),
    [session]
  );
  const forget = useCallback(
    (address?: string): Promise<void> => session.forget(address),
    [session]
  );
  const flush = useCallback((): Promise<void> => session.flush(), [session]);

  return {
    state,
    printers,
    active,
    problem,
    pending,
    print,
    connect,
    select,
    forget,
    flush,
  };
}
