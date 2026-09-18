/**
 * The printer's live operating condition, as read back from the hardware.
 *
 * These fields are **return values, not exceptions**: a printer that is out of
 * paper or has its cover open is not a failure of the query — it is an
 * expected operating condition a caller branches on, same as checking
 * `isConnected` before writing. `readStatus()` itself rejects only when the
 * query could not be carried out at all (see
 * {@linkcode BluetoothPrinter.readStatus}); a fault the printer reports is
 * always a resolved value, never a thrown error.
 *
 * Not every printer, and not every command language, reports every field —
 * ESC/POS and TSPL each expose a different subset of this shape. A field this
 * connection's language or hardware does not report reads `false` rather than
 * being made optional, because "not reported" and "not present" are the same
 * actionable fact for a caller deciding whether to print: there is nothing to
 * warn about, so the safe default is the one that does not block a job.
 */
export interface PrinterStatus {
  /**
   * Whether the printer is ready to accept a job.
   *
   * `false` when a hard fault is present — an unrecoverable error on ESC/POS,
   * or a head-open / paper-jam / out-of-paper condition on TSPL — `true`
   * otherwise. This is a summary of the other fields, not independent
   * evidence: read the specific flags below to know *why*.
   */
  online: boolean;
  /** The paper roll is empty. A job sent now will not print. */
  paperOut: boolean;
  /**
   * The paper roll is running low but not yet empty.
   *
   * Not reported by every printer or every language — see the type-level note
   * on unsupported fields.
   */
  paperNearEnd: boolean;
  /** The printer's cover or head is open. A job sent now will not print. */
  coverOpen: boolean;
  /**
   * The paper path is jammed.
   *
   * Not reported by every printer or every language — see the type-level note
   * on unsupported fields.
   */
  paperJam: boolean;
  /** A fault needing attention that is none of the above. */
  faulted: boolean;
  /**
   * The raw status reply bytes, in query order, for diagnosing a printer this
   * library does not model.
   */
  raw: ArrayBuffer;
}
