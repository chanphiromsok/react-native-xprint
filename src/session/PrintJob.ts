import type { ImageJobOptions } from '../jobs/ImageJobOptions';

/**
 * A print request that could not go out immediately and is waiting for the
 * printer to come back into range.
 *
 * **The queue stores a URI, not the file's bytes.** If the app wrote `source`
 * to a cache directory, the OS is free to evict it before this job runs, and
 * the job will then fail with "couldn't read the document" — not because
 * anything went wrong with the printer, but because the file it was told to
 * print is simply gone. An app that queues a job is committing to keep that
 * file alive (outside a cache directory that can be swept, or otherwise
 * protected) until the job leaves the queue, whether by printing or by being
 * removed.
 */
export interface PrintJob {
  /** Stable id, so a UI can key a list and a caller can cancel one. */
  id: string;
  /** The file URI to print. */
  source: string;
  /** Epoch milliseconds, for showing age and printing oldest first. */
  createdAt: number;
  copies: number;
  overrides?: Partial<ImageJobOptions>;
  /**
   * A short human label for this job, shown when the queue is listed.
   * Something the driver recognises — an order number or a customer name.
   *
   * A queue rendered as "2 waiting" tells a driver nothing about whether
   * printing them right now, in front of whoever is currently at the door,
   * is correct. A label is what turns "2 waiting" into a decision the
   * driver can actually make — "Order #4821 — J. Rivera" is either
   * obviously right to print here or obviously not, in a way an opaque file
   * path or a bare count never is.
   */
  label?: string;
}
