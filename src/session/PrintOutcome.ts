/**
 * What actually happened to a `PrinterSession.print()` call.
 *
 * A driver told "Printed" when the job is really sitting in the queue will
 * walk away from the door without the paperwork the customer needed — so a
 * caller must be able to tell these two outcomes apart rather than treating
 * "the call resolved without throwing" as success. A UI should render
 * `'printed'` as "Printed" and `'queued'` as "Will print when the printer is
 * back in range", not collapse both into one confirmation.
 */
export type PrintOutcome = 'printed' | 'queued';
