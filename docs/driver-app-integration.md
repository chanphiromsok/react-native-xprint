# Driver app integration

How to put printing in front of someone who is not a developer.

The rest of this library is developer-facing: MAC addresses, command languages,
calibration offsets, page indices. A delivery driver must never meet any of it.
This layer exists so their whole experience is *set the printer up once, then tap
Print*.

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

**Headless.** The library ships hooks and a session, not screens. Your app has
its own design system, and drop-in components would fight it. A full reference
implementation lives in the example app — copy it and restyle.

**Printing queues when out of range.** A driver is often at a door while the
printer is in the van. A job taken while offline is persisted, and stays
persisted until the driver chooses to print it — it does **not** print itself
the moment the printer reconnects. Your UI needs a visible pending-jobs
indicator, or work silently disappears — which is worse than an error.

**Reprinting is a deliberate act, not automatic.** By default, `flush()` — the
method that attempts every queued job — is never called for you. Consider why:
a driver prints at stop A, is out of range, the job queues. They drive to
stop B. If the queue printed itself the instant the printer next connected,
stop A's invoice would come out unattended in the van while the driver is at
a door, or worse, get handed to the customer at stop B. The queue's job is to
not lose work, not to decide when that work happens. So the UI is responsible
for showing "2 waiting" and giving the driver a Print button that calls
`flush()` themselves, once they know it is correct to print here. If a
particular deployment genuinely wants queued jobs to flush automatically —
e.g. a single fixed printer no job could ever be "in the wrong place" for —
opt in with `new PrinterSession({ storage, autoFlush: true })`; see
`PrinterSessionOptions.autoFlush` for the full reasoning before doing that.

**The queue is shared, not per-printer.** A job queued in one van prints on
whichever printer is active when it next connects. That is deliberate: a driver
who queued an invoice and then swapped vans still needs that paperwork, and
holding it hostage to a printer they have walked away from helps nobody. The
label geometry follows the printer that actually prints it, because content is
fitted to that printer's media at print time rather than at queue time.

**Only retryable failures queue.** Out of range queues and tells the driver it
will print later. Bluetooth switched off, permission denied, or no printer set
up do not queue — a job that can never run just hides a problem the driver has
to fix.

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
