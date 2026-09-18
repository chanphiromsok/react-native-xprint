import type { PrinterProblem } from './PrinterProblem';

/**
 * One translation rule: if `test` matches the original error message, the
 * error means `problem` to the driver.
 *
 * A regexp rather than a plain substring where the native message sandwiches
 * a detail between two fixed fragments (a page number, say) — matching only
 * the fragments keeps the rule from breaking when that detail changes.
 */
interface ProblemRule {
  test: RegExp;
  problem: Omit<PrinterProblem, 'cause'>;
}

/**
 * Substrings thrown from the Kotlin side, matched in order and
 * case-insensitively against the real error message.
 *
 * Order matters: this list is walked top to bottom and the first match wins,
 * so a more specific fragment (e.g. the two permission-plumbing messages)
 * must be listed before anything broad enough to also contain it. Keep this
 * table in sync with the native error messages it documents — a wording
 * change on the Kotlin side silently stops matching here.
 */
const RULES: ProblemRule[] = [
  {
    test: /no bluetooth adapter/i,
    problem: {
      title: "This phone can't print",
      action: 'This phone has no Bluetooth. Use a different device.',
      retryable: false,
    },
  },
  {
    test: /bluetooth is turned off/i,
    problem: {
      title: 'Bluetooth is off',
      action: 'Turn on Bluetooth, then try again.',
      retryable: false,
    },
  },
  {
    test: /missing bluetooth permission/i,
    problem: {
      title: 'Permission needed',
      action: 'Allow nearby device access when your phone asks.',
      retryable: false,
    },
  },
  {
    test: /does not implement permissionawareactivity|no activity is attached/i,
    problem: {
      title: 'Permission needed',
      action: 'Open the app and try again.',
      retryable: true,
    },
  },
  {
    test: /not a valid bluetooth mac address/i,
    problem: {
      title: 'Printer not recognised',
      action: 'Set the printer up again.',
      retryable: false,
    },
  },
  {
    test: /could not open a serial port connection/i,
    problem: {
      title: "Can't reach the printer",
      action: 'Check the printer is switched on and nearby, then try again.',
      retryable: true,
    },
  },
  {
    test: /the connection is closed|was closed mid/i,
    problem: {
      title: 'Lost connection',
      action: 'Check the printer is still on, then try again.',
      retryable: true,
    },
  },
  {
    test: /failed to write/i,
    problem: {
      title: 'Printing stopped',
      action: 'Check the printer has paper and is in range, then try again.',
      retryable: true,
    },
  },
  {
    test: /which command language/i,
    problem: {
      title: 'Printer not set up properly',
      action: 'Set the printer up again.',
      retryable: false,
    },
  },
  {
    test: /no label stock configured/i,
    problem: {
      title: 'Printer not set up',
      action: 'Set the printer up again.',
      retryable: false,
    },
  },
  {
    test: /could not decode an image|there is no file at/i,
    problem: {
      title: "Couldn't read the document",
      action: 'Try printing again.',
      retryable: true,
    },
  },
  {
    test: /page .*does not exist/i,
    problem: {
      title: "Couldn't read the document",
      action: 'Try printing again.',
      retryable: true,
    },
  },
];

const FALLBACK: Omit<PrinterProblem, 'cause'> = {
  title: 'Printing failed',
  action: 'Try again. If it keeps happening, set the printer up again.',
  retryable: true,
};

/**
 * Turns whatever this library threw into something a delivery driver can
 * act on, instead of a Kotlin exception message.
 *
 * The native layer's errors are strings, not typed exceptions, so this
 * matches on the substrings documented above rather than an error code —
 * see `RULES` for the mapping and why order matters. Anything unrecognised
 * still gets a usable, retryable message rather than surfacing raw text.
 */
export function describePrinterProblem(error: unknown): PrinterProblem {
  const cause = error instanceof Error ? error.message : String(error);
  const rule = RULES.find(({ test }) => test.test(cause));
  return { ...(rule === undefined ? FALLBACK : rule.problem), cause };
}
