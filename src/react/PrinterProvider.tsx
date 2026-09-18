import type { ReactElement, ReactNode } from 'react';
import { createElement } from 'react';
import type { PrinterSession } from '../session/PrinterSession';
import { PrinterContext } from './PrinterContext';

export interface PrinterProviderProps {
  session: PrinterSession;
  children?: ReactNode;
}

/**
 * Makes a `PrinterSession` available to `usePrinter` anywhere beneath it.
 *
 * The session is constructed by the app, not by this provider, because the
 * storage adapter it needs (`PrinterStorage`) is an app concern — which
 * `AsyncStorage`/MMKV/whatever instance to use is not something this library
 * can decide on the app's behalf. Building the session here instead would
 * also tie its lifetime to this component's, so a remount (a navigator
 * resetting a stack, a screen unmounting and remounting) would silently
 * drop the open Bluetooth connection and the in-memory printer list. The
 * app owns the session for as long as the app runs; this component only
 * hands it down.
 */
export function PrinterProvider(props: PrinterProviderProps): ReactElement {
  return createElement(
    PrinterContext.Provider,
    { value: props.session },
    props.children
  );
}
