# Driver app integration

How to put printing in front of someone who is not a developer.

This library is developer-facing: MAC addresses, command languages, calibration
offsets, page indices. A delivery driver must never meet any of it. What follows
is a **reference architecture**, not a package export — `PrinterSession`,
`PrinterStorage`, and the React bindings that wrap them live in the example
app's `example/src/session/` and `example/src/hooks/`, built entirely on the
library's public API (`Xprinter`, `PrinterImages`, the `print*` job functions,
`describePrinterProblem`, calibration profiles). Copy those folders into your
app as a starting point; nothing about this layer is special beyond being
already written and hardware-tested. The goal either way is the same: a
driver's whole experience is *set the printer up once, then tap Print*.

## What the driver sees

**Once, at setup**

1. Tap "Set up printer".
2. Pick their printer from a list of names — "XP-P323B", not `DC:0D:30:6F:A0:3F`.
3. A test label prints. "Did that print?" Yes → done.

**Every day after**

1. Open the app. The printer reconnects by itself.
2. Tap Print.

**When something is wrong**

One short line and a thing to do: *"Bluetooth is off. Turn on Bluetooth, then try
again."* Never a stack trace, never an error code, never the words TSPL or
RFCOMM.

## What the driver never sees

| Hidden | Where it lives instead |
| --- | --- |
| MAC addresses | `SavedPrinter.address`, persisted at setup |
| ESC/POS vs TSPL | detected once at setup, saved, re-applied on reconnect |
| Calibration, media geometry | `PrinterCalibration` from a model profile |
| Page counts, `pageIndex` | `printPdfAsLabel` walks the pages |
| Reconnect logic | `PrinterSession` |

## The three pieces

All three below are example-level code (`example/src/session/`), not library
exports — see the note at the top of this doc.

### `PrinterSession` — the state machine

Framework-agnostic. Owns the saved printers, the live connection, and the last
problem. Everything else is built on it.

```ts
const session = new PrinterSession({ storage });
await session.restore(); // on app start
```

#### More than one printer

A driver may work from different vans, or share a depot printer, so the session
keeps a **list** of set-up printers with one of them active:

```ts
session.printers;            // everything ever set up, most recent first
session.active;              // the one Print will use
await session.select(addr);  // switch vans
await session.setUp(addr);   // pair a new one; becomes active
await session.forget(addr);  // drop one, defaulting to the active one
```

Switching is the common case, not an edge case: the driver picks from a list of
names they recognise, and each printer carries its own calibration and media, so
a 50 x 30 label printer and an 80 mm receipt printer can both be set up and
swapped between without reconfiguring anything.

Only one connection is open at a time. `select()` disconnects the previous
printer before opening the next — Bluetooth Classic will not reliably hold two
RFCOMM sockets from a phone anyway, and a driver only ever prints to the one in
front of them.

States a UI renders: `unconfigured`, `connecting`, `ready`, `printing`,
`offline`, `failed`.

`restore()` deliberately **does not throw** when the saved printer is out of
range — it settles on `offline`. An app must not fail to start because a printer
is in a van.

### `PrinterProblem` — failures in plain language

```ts
{ title, action, retryable, cause }
```

`title` and `action` are for the driver; `cause` is for your logs and never
reaches the screen. `retryable` tells your UI whether to offer "Try again" or
send them to settings.

`describePrinterProblem(error)` maps the library's real failures onto these.

### Storage is an adapter

```ts
interface PrinterStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

AsyncStorage, MMKV, or your own database all satisfy this. The library takes no
dependency on any of them.

## Design decisions worth knowing

**Nothing on this page is a library export.** `PrinterSession`, `PrinterStorage`,
and the React bindings (`PrinterProvider`, `usePrinter`, `usePrinterSession`,
`usePrinterSetup`) all live in the example app (`example/src/session/`,
`example/src/hooks/`), built entirely on the library's actual public
surface — `Xprinter`, `PrinterImages`, the `print*` job functions,
`describePrinterProblem`, calibration profiles. `PrinterSession` itself has
no React in it, by design, so it backs a hook, a store, or a plain script
equally well; the hooks are one choice of binding, not the only one a
Zustand/Redux store works just as well against the same session. Copy
either folder into your app and restyle, or write your own layer directly
against the library's primitives if this shape doesn't fit your app.

**No queue or retry policy.** `print()` either succeeds or throws — it does not
persist a failed job or decide when to try it again. Whether a failure while
out of range should be silently retried, queued for the driver to act on
later, or just shown as an error is a product decision that varies by app: a
driver roaming between stops and a fixed depot printer want different answers,
and a library imposing one would be wrong for the other. `describePrinterProblem(error).retryable`
tells you whether a failure is the kind worth retrying (out of range,
mid-reconnect) versus one that will not resolve itself (Bluetooth off,
permission denied, no printer set up) — build whatever queueing or retry
behavior your app needs on top of that, the same way the example app's
`PrintScreen` calls `print()` directly and reads `problem.retryable` to decide
whether to show a "Try again" button.

**Status is checked before printing, and a failed check does not block.** Many
low-cost printers implement no status command at all. When the printer does
answer, "out of paper" reaches the driver before they walk away with a blank
receipt. When it does not, the print proceeds.

**Paper out is a return value, not an exception.** It is an expected operating
condition to branch on. Exceptions mean the operation could not be carried out.

## Setting up a new printer model

The shipped `XPRINTER_P323B` profile was measured, not guessed. For a different
model, print `tsplCalibrationLabel` with the origin offset at zero and read the
geometry off the paper:

- The gap between the paper edge and the frame is `originOffsetMm`.
- Where the frame's right edge stops printing is the true `printableWidthMm`.
- A missing frame edge means the canvas overhangs the label there.

One label, and the values are measurements rather than guesses. See
[printer-core.md](printer-core.md) §4.1.

## What is not built yet

- **Reconnect on printer power-cycle.** Reconnection happens on the next print
  or app start, not the moment the printer comes back.
- **iOS.** Bluetooth Classic is not available to third-party apps; see the
  README.
