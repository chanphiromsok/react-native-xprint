/**
 * A printer error translated for the person holding the phone, not the
 * developer who logged it.
 *
 * `PrinterSession` deals in Kotlin exception messages — meaningful to us,
 * meaningless to a delivery driver staring at a failed print. This is the
 * shape a status screen renders instead: a plain-language title, a concrete
 * next step, and whether that step is "just try again". `cause` keeps the
 * original message alive for support and logs without ever putting it in
 * front of the driver.
 */
export interface PrinterProblem {
  /** One short line a non-technical user can act on. No jargon, no error codes. */
  title: string;
  /** What to do about it, in the imperative. */
  action: string;
  /** Whether simply trying again might work without the user changing anything. */
  retryable: boolean;
  /** The underlying message, for logs and bug reports. Never shown to a driver. */
  cause: string;
}
