# Printer core — technical backbone

The architecture the rest of this library is built on. It defines the layers, the
objects that live in each, who owns which thread, and what the boundaries between
them guarantee.

Everything here is grounded in behaviour observed on real hardware (an XPrinter
XP-P323B over Bluetooth Classic, Android 14). Where a design decision exists
because a printer forced it, that is stated — those are the parts not to
"simplify" later.

## 1. What the hardware established

Five findings shaped this design. Each one is a constraint, not a preference.

| Finding | Consequence for the architecture |
|---|---|
| A connect and a write can both succeed while nothing prints, because the printer is in a different command language | **The command language is a first-class part of a session**, not a detail the caller encodes by hand. The library must know which language a connection is speaking. |
| A single 45 KB write to a thermal printer stalls | **Transport writes are chunked and paced.** Byte delivery is the transport layer's problem, never the caller's. |
| The printer's stored `DIRECTION` was `1`, so images printed upside down unless overridden | **Orientation is calibration, not a constant.** It belongs to a per-printer profile, set explicitly on every job. |
| The printable origin sat 2 mm right of the paper edge, so a centered bitmap landed off-center | **Geometry needs a calibrated origin offset.** Centering maths alone is not enough. |
| `BLUETOOTH_SCAN` without `neverForLocation` makes Android 12+ refuse to scan | **Transport discovery carries platform preconditions** that must be checked before the operation, with an error that names the fix. |

The through-line: a printer is not a byte sink. It is a device with a language, a
geometry, and a state, and the library's job is to model those three things so the
caller does not have to discover them by trial.

## 2. Layer model

```
┌─────────────────────────────────────────────────────────────┐
│ L5  Status          readStatus() — paper, cover, errors     │
├─────────────────────────────────────────────────────────────┤
│ L4  Documents       ReceiptJob / LabelJob → bytes           │
├─────────────────────────────────────────────────────────────┤
│ L3  Encoders        ESC/POS · TSPL · CPCL (native, internal)│
├─────────────────────────────────────────────────────────────┤
│ L2  Session         Printer: identity, capabilities,        │
│                     calibration, job factories              │
├─────────────────────────────────────────────────────────────┤
│ L1  Transport       Bluetooth SPP · USB · TCP               │
│                     chunking, framing, lifecycle            │
└─────────────────────────────────────────────────────────────┘
        Rasterization (PrinterImages) feeds L4 sideways.
```

Each layer may only depend on the one below it. Encoders (L3) are internal — they
have no JS-facing surface, because exposing them would put the caller back in the
business of choosing byte sequences.

## 3. L1 — Transport

A transport is a byte pipe with a lifecycle. It knows nothing about printing.

```ts
export type TransportKind = 'bluetooth' | 'usb' | 'network';

export interface PrinterTransport
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly kind: TransportKind;
  readonly isOpen: boolean;
  /** Writes bytes, chunked and paced to suit the link. Resolves when flushed. */
  write(data: ArrayBuffer): Promise<void>;
  /** Reads up to `maxBytes`, or resolves with an empty buffer on timeout. */
  read(maxBytes: number, timeoutMs: number): Promise<ArrayBuffer>;
  close(): Promise<void>;
}
```

**Responsibilities that live here and nowhere else:**

- Chunking. `write` never hands the whole payload to the OS at once. Bluetooth
  SPP uses 512-byte chunks, kept under the 1008-byte RFCOMM frame payload.
- Serialization. Writes complete in call order on a single owner thread, so two
  concurrent callers cannot interleave on the wire.
- Lifecycle. `close()` is callable from any thread and aborts a blocked write —
  on a `BluetoothSocket` that is the only way to unblock one.

**Why `read` exists:** status queries (L5) need the reply. The transport owns the
input stream and is its only consumer; nothing else may read it, or the two
readers will split a reply between them.

Connecting is a per-transport factory method rather than one method taking a
tagged union, because the parameters have nothing in common and future transports
should not widen an existing signature:

```ts
connectBluetooth(address: string): Promise<Printer>;
connectUsb(deviceId: number): Promise<Printer>;        // later
connectNetwork(host: string, port: number): Promise<Printer>; // later
```

## 4. L2 — Session

`Printer` is the connected device: a transport plus everything known about what is
on the other end.

```ts
export type CommandLanguage = 'escpos' | 'tspl' | 'cpcl';

export interface PrinterIdentity {
  language: CommandLanguage;
  /** How the language was determined — probing is best-effort. */
  source: LanguageSource;      // 'probed' | 'declared' | 'profile'
  model?: string;
  firmware?: string;
}

export interface PrinterCapabilities {
  printableWidthDots: number;
  dotsPerMm: number;
  canPrintReceipts: boolean;
  canPrintLabels: boolean;
  canCut: boolean;
  canReportStatus: boolean;
}

export interface PrinterCalibration {
  /** TSPL DIRECTION, or the equivalent rotation on other languages. */
  direction: 0 | 1;
  /** Nudge applied to every placement, in dots. The XP-P323B needs x = -16. */
  originOffsetDots: Point;
  /** Blank edge kept clear of the printable-area boundary. */
  marginDots: number;
}

export interface Printer extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly device: PrinterDeviceInfo;
  readonly transport: TransportKind;
  readonly isConnected: boolean;

  /** Probes the device for its language and model. Best-effort; see §4.1. */
  identify(): Promise<PrinterIdentity>;
  /** Skips probing when the caller already knows. */
  declareLanguage(language: CommandLanguage): void;

  readonly identity?: PrinterIdentity;
  readonly capabilities: PrinterCapabilities;

  calibration: PrinterCalibration;

  createReceipt(): Promise<ReceiptJob>;
  createLabel(options: LabelOptions): Promise<LabelJob>;

  readStatus(): Promise<PrinterStatus>;
  /** Escape hatch for commands this library does not model. */
  writeRaw(data: ArrayBuffer): Promise<void>;
  disconnect(): Promise<void>;
}
```

### 4.1 Language detection

`identify()` probes rather than guesses, because guessing is what cost a debugging
session:

1. Send TSPL `SELFTEST`-adjacent status query `<ESC>!?` and read with a short
   timeout. A reply means TSPL.
2. Send ESC/POS `DLE EOT 1` and read. A reply means ESC/POS.
3. No reply from either → resolve with `source: 'profile'` and the language from
   the model profile, or reject if the model is unknown.

Probing is **best-effort and must be overridable**. `declareLanguage()` exists so
an app that ships with known hardware never pays for a probe, and so a printer
that answers neither query is still usable.

### 4.2 Why receipts and labels are separate objects

They are different contracts, not two modes of one:

| | Receipt (ESC/POS) | Label (TSPL) |
|---|---|---|
| Canvas | continuous, unbounded | fixed `SIZE`, bounded |
| Placement | flows top-down | absolute `x, y` |
| Terminator | `cut()` / feed | `PRINT copies, sets` |
| Media | continuous roll | gap / black-mark / continuous |

Modelling both as one `PrinterJob` would mean a `setPosition()` that does nothing
on receipts and a `cut()` that does nothing on labels — the caller then has to
check capabilities before every call. Instead, `createLabel()` rejects on a
printer that cannot print labels, and the object you get back only has methods
that work.

## 5. L4 — Document model

Jobs accumulate natively and compile once. This is not a style choice: a
full-width label raster is tens of kilobytes, and a JS-side builder would pull
every image across the bridge to concatenate it.

```ts
export interface ReceiptJob extends HybridObject<...> {
  text(text: string, style: TextStyle): ReceiptJob;
  image(raster: PrinterRaster, align: Alignment): ReceiptJob;
  barcode(spec: BarcodeSpec): ReceiptJob;
  feed(lines: number): ReceiptJob;
  cut(mode: CutMode): ReceiptJob;

  readonly byteLength: number;
  /** The compiled bytes, for tests and debugging. */
  toBytes(): ArrayBuffer;
  /** Compiles and sends over the owning printer's transport. */
  print(): Promise<void>;
}

export interface LabelJob extends HybridObject<...> {
  text(at: Point, text: string, style: TextStyle): LabelJob;
  image(at: Point, raster: PrinterRaster): LabelJob;
  /** Centers horizontally, applying the printer's calibrated origin offset. */
  imageCentered(atY: number, raster: PrinterRaster): LabelJob;
  barcode(at: Point, spec: BarcodeSpec): LabelJob;
  box(rect: Rect, thicknessDots: number): LabelJob;

  readonly byteLength: number;
  toBytes(): ArrayBuffer;
  print(copies: number): Promise<void>;
}
```

`imageCentered` exists because centering is the operation callers actually want
and it is the one that needs calibration applied. Leaving them to compute
`(labelWidth - rasterWidth) / 2 + offsetX` is how the invoice ended up off-center.

**Jobs are bound to the printer that created them.** `print()` needs no argument
and cannot be sent to the wrong device. A job whose printer has disconnected
rejects.

## 6. L3 — Encoders (internal)

One encoder per command language, selected by the session, never named by the
caller. Each implements the same native interface:

```kotlin
internal interface CommandEncoder {
  fun begin(calibration: PrinterCalibration): ByteArray
  fun text(text: String, style: TextStyle): ByteArray
  fun image(raster: MonochromeRaster, at: Point): ByteArray
  fun barcode(spec: BarcodeSpec, at: Point?): ByteArray
  fun cut(mode: CutMode): ByteArray
  fun end(copies: Int): ByteArray
}
```

`EscPosEncoder` and `TsplEncoder` exist today in embryonic form as
`MonochromeRaster+toEscPosRaster.kt` and `MonochromeRaster+toTsplBitmap.kt`.
Promoting them to full encoders is the single largest piece of remaining work.

Note the polarity trap already encoded in those files: **TSPL treats a set bit as
white, ESC/POS treats a set bit as black.** The raster is stored ESC/POS-style and
the TSPL encoder inverts. Any third encoder must state its convention explicitly.

## 7. L5 — Status

```ts
export interface PrinterStatus {
  online: boolean;
  paperOut: boolean;
  paperNearEnd: boolean;
  coverOpen: boolean;
  /** Head over-temperature, cutter jam, and similar hard faults. */
  faulted: boolean;
  /** Raw reply bytes, for diagnosing a printer this library does not model. */
  raw: ArrayBuffer;
}
```

Status is a **return value, not an exception**. Paper running out is an expected
operating condition the caller branches on; it is not a failure of `readStatus()`.
Exceptions are reserved for the call itself failing — link dropped, timeout, a
printer that cannot report status at all.

This is the general error rule for the whole backbone:

> Predictable, actionable device states are modelled in return types. Exceptions
> mean the operation could not be carried out.

## 8. Cross-cutting

### Threading and ownership

Every piece of mutable native state has exactly one owner thread. Crossing happens
once, at a Promise or callback boundary.

| State | Owner | Why |
|---|---|---|
| Discovery receiver, permission dialog | Android main thread | The platform accepts them from nowhere else. |
| Socket read/write, per connection | One dedicated thread per `Printer` | Serializes writes; blocking reads must not touch a shared pool. |
| Rasterization, image decode | IO dispatcher | CPU-bound for hundreds of ms on a full-width image. |
| Job accumulation | The calling thread, guarded | Jobs are cheap appends; no hop is justified. |

No operation hops more than once. A chain of `Task`/dispatcher/JS hops inside one
call means a boundary is in the wrong place.

### Memory

Anything holding native bytes reports `memorySize` so the JS GC can see its true
cost: rasters report their dot data, connections report their socket buffers, jobs
report their accumulated length. Without this, the JS heap looks empty while
megabytes sit off it.

### Errors

Messages name the fix, not just the fault. `"Bluetooth is turned off. Ask the user
to enable it before scanning or connecting."` — not `"IOException"`. This is a
library whose failures are mostly operator-correctable, and a message that does
not say what to do wastes the operator's time.

## 9. Object map

| Object | Autolinked | Created by | Layer |
|---|---|---|---|
| `PrinterDiscovery` | yes | `createHybridObject` | L1 |
| `PrinterImages` | yes | `createHybridObject` | raster |
| `Printer` | no | `connect*()` | L2 |
| `ReceiptJob` / `LabelJob` | no | `createReceipt/Label()` | L4 |
| `PrinterRaster` | no | `rasterize()` | raster |
| `PrinterTransport` | no | internal to `Printer` | L1 |

Only roots the caller must construct directly are autolinked. Everything else
arrives from a factory method that has already made it valid — there is no way to
hold a `Printer` that was never connected or a `LabelJob` for a receipt printer.

## 10. File layout

```
src/
  specs/          PrinterDiscovery · Printer · ReceiptJob · LabelJob
                  PrinterRaster · PrinterImageFactory
  types/          one named type per file (Nitro needs names for structs/enums)

android/src/main/java/com/margelo/nitro/xprinter/
  HybridPrinterDiscovery.kt      orchestration only
  HybridPrinter.kt               session state, job factories
  HybridReceiptJob.kt
  HybridLabelJob.kt
  transport/     BluetoothSppTransport.kt · UsbTransport.kt · TcpTransport.kt
  encoders/      EscPosEncoder.kt · TsplEncoder.kt · CpclEncoder.kt
  raster/        MonochromeRasterizer.kt · MonochromeRaster.kt · SourceImageLoader.kt
  profiles/      PrinterProfiles.kt    model → capabilities + calibration
  <Type>+<operation>.kt            converters, one conversion per file
```

`Hybrid*` files stay orchestration. Preflight checks, conversions and platform
helpers live in their own named files — a factory file that grows barcode tables
or permission switches has drifted.

## 11. Phases

**Phase 0 — done.** Bluetooth SPP transport with chunked writes, discovery and
permissions, raw `write`, native rasterization with dithering and flips, TSPL and
ESC/POS raster encoding. Verified end to end on an XP-P323B.

**Phase 1 — session layer.** Introduce `Printer` with `identity`, `capabilities`
and `calibration`; move chunking behind `PrinterTransport`; add `readStatus()` and
the transport `read`. Existing `BluetoothPrinter` becomes `Printer` + the
Bluetooth transport. *This is the phase that pays off the debugging session: after
it, "nothing printed" is answerable by the library rather than by trial.*

**Phase 2 — encoders and jobs.** Promote the two raster encoders into full
`CommandEncoder`s; add `ReceiptJob` and `LabelJob`. Callers stop assembling bytes.

**Phase 3 — profiles.** A model → capabilities + calibration table, so a known
printer works without hand-tuning `direction` and `originOffsetDots`. Seed it with
the XP-P323B values verified here.

**Phase 4 — transports.** USB and TCP. The session layer should need no changes;
if it does, the L1/L2 boundary was drawn wrong.

## 12. Decisions still open

- **Barcodes.** Delegate to the printer's native barcode commands (sharp, but
  varies by language and model) or rasterize them ourselves (uniform, but larger
  payloads and a scannability risk from dithering)? Leaning native with a
  rasterized fallback.
- **Text on label printers.** TSPL `TEXT` uses printer-resident fonts, which
  differ per model and handle non-Latin scripts poorly. For Khmer and similar,
  rendering text to a raster may be the only reliable route — which would make
  `LabelJob.text()` a convenience over `image()` rather than a distinct path.
- **Profile distribution.** Bundled in the package, or fetched? Bundled is
  simpler and offline-safe; fetched scales to XPrinter's catalogue without a
  release. Start bundled.
- **iOS.** Bluetooth Classic stays out of reach. If iOS support is ever needed it
  will be a BLE or MFi transport at L1, and L2 upward should be unaffected — which
  is a useful test of whether the transport boundary is honest.
