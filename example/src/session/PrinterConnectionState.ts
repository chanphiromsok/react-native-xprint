/**
 * The lifecycle a UI renders for the one printer a `PrinterSession` manages.
 *
 * These are deliberately coarser than the underlying connection events —
 * a screen drawing a status pill or a print button needs "can I print right
 * now, and if not, why", not a blow-by-blow of sockets opening and closing.
 * Each member below is a distinct answer to that question.
 */
export type PrinterConnectionState =
  /** No printer has been set up yet — show the pairing flow, not a status. */
  | 'unconfigured'
  /** A connect is in flight, to a saved printer or a newly chosen one. */
  | 'connecting'
  /** Connected and idle. The print button should be enabled. */
  | 'ready'
  /** A print job is in flight. Disable the print button; this is not a hang. */
  | 'printing'
  /**
   * A printer is set up but the last connection attempt failed to reach it —
   * out of range, switched off, or someone else's radio in the way. Not the
   * same as `'failed'`: this is a transient, unsurprising state a driver sees
   * every day and `restore()` reaches it without throwing.
   */
  | 'offline'
  /**
   * The last operation failed for a reason worth surfacing beyond simple
   * unreachability — see `PrinterSession.problem` for what to show and what
   * to tell the driver to do about it.
   */
  | 'failed';
