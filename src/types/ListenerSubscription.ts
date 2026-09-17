/**
 * Owns a single listener registration. Call `remove()` to stop receiving events.
 *
 * Removing a subscription only stops future events; a callback that a native
 * event has already picked up may still run once.
 */
export interface ListenerSubscription {
  /** Unsubscribes this listener. Calling it more than once is a no-op. */
  remove: () => void;
}
