# react-native-xprint

Find nearby Bluetooth Classic printers and print to them from React Native, built
on [Nitro Modules](https://nitro.margelo.com/).

> **Android only.** Bluetooth Classic (RFCOMM / SPP) is what XPrinter and most
> other thermal receipt printers speak, and iOS does not expose it to third-party
> apps — reaching a printer there needs BLE or an MFi-certified accessory. The
> iOS build compiles and every call reports this clearly; guard with
> `Xprinter.isSupported`.

## Installation

```sh
npm install react-native-xprint react-native-nitro-modules
```

`react-native-nitro-modules` is a required peer dependency.

The Android permissions (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, and the pre-API-31
equivalents) are declared by this library and merge into your app's manifest —
you do not need to add them yourself. `BLUETOOTH_SCAN` is declared with
`neverForLocation`, so your app does not need location access.

## Usage

```ts
import { Xprinter } from 'react-native-xprint';

// 1. Ask for the runtime permissions.
if ((await Xprinter.requestPermissions()) !== 'granted') {
  return; // 'blocked' means the user must re-enable them in system settings.
}

// 2a. Fast path: printers already paired in the system Bluetooth settings.
const paired = await Xprinter.getBondedDevices();

// 2b. Or scan for printers that have never been paired.
const subscription = Xprinter.addDeviceFoundListener((device) => {
  console.log(device.name, device.address, device.rssi);
});
await Xprinter.startDiscovery(); // Android stops it by itself after ~12s.

// 3. Connect, find out what the printer speaks, and print.
const printer = await Xprinter.connect('66:32:10:B2:A1:0C');
const { likely } = await printer.detectLanguage(); // 'tspl' | 'escpos' | undefined
await printer.write(buildJobFor(likely));
await printer.disconnect();

subscription.remove();
```

The [example app](example/src/App.tsx) is a complete version of this: permissions,
a merged paired + discovered device list, and a tap-to-print ESC/POS test receipt.

## API

### `Xprinter`

| Member | Description |
| --- | --- |
| `isSupported: boolean` | `false` on iOS and on Android hardware without a Bluetooth adapter. |
| `isEnabled: boolean` | Whether the adapter is switched on. |
| `isDiscovering: boolean` | Whether a scan is running. |
| `permissionStatus: BluetoothPermissionStatus` | Current state, without prompting. Never reports `'blocked'`. |
| `requestPermissions(): Promise<BluetoothPermissionStatus>` | Prompts for anything missing. |
| `getBondedDevices(): Promise<BluetoothDeviceInfo[]>` | Devices already paired with the phone. |
| `startDiscovery(): Promise<void>` | Starts a scan; resolves when it has started, not when it ends. |
| `stopDiscovery(): Promise<void>` | Stops a running scan. |
| `addDeviceFoundListener(listener): ListenerSubscription` | One call per device found. A device may repeat within a scan. |
| `addDiscoveryStateListener(listener): ListenerSubscription` | Fires when a scan starts or stops, including Android's own timeout. |
| `connect(address): Promise<BluetoothPrinter>` | Opens an SPP connection. Pairs first if the device is not bonded. |

### `BluetoothPrinter`

| Member | Description |
| --- | --- |
| `device: BluetoothDeviceInfo` | The device this connection was opened to. |
| `isConnected: boolean` | `false` after `disconnect()` or after a write failed. |
| `write(data: ArrayBuffer): Promise<void>` | Sends raw ESC/POS or TSPL bytes. Writes are serialized in call order. |
| `read(maxBytes, timeoutMs): Promise<ArrayBuffer>` | Reads a reply, giving up after the timeout. Serialized with `write`. |
| `detectLanguage(): Promise<LanguageProbe>` | Asks the printer which command language it is in. |
| `language?: CommandLanguage` | Remembered once detected or declared. |
| `declareLanguage(language)` | Sets it directly, skipping detection. |
| `calibration: PrinterCalibration` | Hardware: resolution, printable width, origin offset, orientation. |
| `media?: LabelMedia` | The stock currently loaded. |
| `disconnect(): Promise<void>` | Closes the socket. |

Connecting tries a secure RFCOMM socket first and falls back to an insecure one,
because many low-cost thermal printers ship without a PIN and refuse the
authenticated channel.

### Job helpers

| Function | Description |
| --- | --- |
| `printImageAsLabel(printer, source, options?, copies?)` | Rasterizes and prints centred on a label. |
| `printImageAsReceipt(printer, source, options?)` | Same for receipt printers. |
| `printPdfAsLabel(printer, source, options?, copies?)` | Every page of a PDF, one label each. |
| `printPdfAsReceipt(printer, source, options?)` | Every page, one receipt each. |
| `PrinterImages.rasterize(options)` | Image or PDF page to printer dots. |
| `PrinterImages.countPages(source)` | Page count for a PDF, `1` for an image. |
| `pdfPageSizeFor(media)` | PDF page size in points matching the label's shape. |
| `tsplCalibrationLabel(media, dotsPerMm)` | Calibration target for measuring geometry. |
| `XPRINTER_P323B` | Measured calibration for that model. |

## Printing PDFs

Anything with layout — an HTML invoice, a text document — is easiest to hand over
as a PDF, and `expo-print` turns HTML into one:

```ts
import * as Print from 'expo-print';
import { pdfPageSizeFor, printPdfAsLabel, Xprinter, XPRINTER_P323B } from 'react-native-xprint';

const printer = await Xprinter.connect(address);
printer.calibration = XPRINTER_P323B;
printer.media = { widthMm: 70, heightMm: 80, type: 'printerDefault' };

const { uri } = await Print.printToFileAsync({
  html: invoiceHtml,
  ...pdfPageSizeFor(printer.media), // page shaped like the label
});

await printPdfAsLabel(printer, uri); // every page, in order
```

### Size the page like the label

`printToFileAsync` defaults to **612 x 792 points — US Letter**, whatever the
printer is loaded with. That is ratio 0.77; a 70 x 80 mm label is 0.875.

Since a rendered page is fitted inside the label's content area with its aspect
ratio preserved, a Letter-shaped PDF is constrained by its height and prints
about **59 mm wide on a 70 mm label**, leaving white bars down both sides.

`pdfPageSizeFor(media)` returns the points that match the loaded stock, so the
page and the label are the same shape and nothing is left over. Change the roll,
change `printer.media`, and the page size follows.

The source's pixel dimensions never matter — only its aspect ratio. A 1118 x 1278
PNG and a 5000 x 5715 one print identically.

`printPdfAsLabel` prints one label per page; `printPdfAsReceipt` does the same for
receipt printers. Both accept plain images too — a non-PDF counts as one page — so
you do not need to branch on the source type.

For a single page, `printImageAsLabel(printer, uri, { pageIndex: 2 })` renders just
that one, and `PrinterImages.countPages(uri)` tells you how many there are.

Three things worth knowing:

- **The format is detected from the file's contents, not its extension.** A
  `content://` URI from a picker often has no usable name, and `printToFileAsync`
  output gets renamed often enough that the suffix cannot be trusted.
- **PDF pages are rendered straight to the printer's dot width.** A PDF is vector
  art, so rasterizing at the final size keeps text and barcode bars crisp;
  decoding at some default resolution and scaling up would soften every edge
  before dithering ever sees it.
- **Pages print sequentially, never concurrently.** A printer reads its input as
  one ordered stream, so overlapping writes would interleave two pages into one
  garbled label.

## Command languages

This library is a transport: `write()` sends the bytes you give it, unchanged.
Which bytes are correct depends on the command language the printer is currently
set to, and XPrinter hardware is multi-protocol.

The XP-P323B, for example, understands TSPL, EPL, ZPL, DPL, CPCL and ESC/POS,
selected from its own menu — and **silently discards** a job written in any of
the others. A connect and a write that both succeed while nothing comes out of
the printer almost always means the job is in the wrong language, not that the
Bluetooth link failed.

- **ESC/POS** — receipt printers. Binary control codes, e.g. `1B 40` to
  initialise. See [`example/src/escpos.ts`](example/src/escpos.ts).
- **TSPL** — label printers. Line-oriented ASCII terminated with CRLF, e.g.
  `CLS`, `TEXT ...`, `PRINT 1,1`. See [`example/src/tspl.ts`](example/src/tspl.ts).

### Which language is my printer in?

Ask it:

```ts
const printer = await Xprinter.connect(address);
const probe = await printer.detectLanguage();

probe.likely;        // 'tspl' | 'escpos' | undefined
probe.model;         // 'XP-P323B' — TSPL reports its model name
probe.escPosReplied; // false
probe.tsplReplied;   // true
```

A conclusive probe is remembered on the connection as `printer.language`, so the
detection is paid for once. `printer.declareLanguage('tspl')` sets it directly
when the hardware is known, or overrides a probe that came back inconclusive.

`detectLanguage()` asks each language for its status and sees which answers:
ESC/POS `DLE EOT 1` (`10 04 01`) first, because it is a real-time command that
prints nothing on either language, then TSPL `~!T` only if ESC/POS stayed silent —
an ESC/POS printer would print `~!T` as text rather than answer it. On an ESC/POS
printer the probe therefore costs no paper at all.

`likely` is `undefined` when both answered or neither did. Treat it as a strong
hint to default to, not proof: silence can also mean the printer is busy or does
not implement the status command. Always let the user override it.

Failing that, a printer's own configuration page — from its menu, or a
button-hold at power-on — names the active command mode.

When writing TSPL, prefer to leave `SIZE` and `GAP` out and let the printer use
its configured media settings — guessing them wrong misfeeds the labels.

## Printing images

Receipts and invoices are usually easier to lay out as an image than as printer
commands. `PrinterImages.rasterize(...)` does the conversion natively — decode,
scale to the head's dot width, and reduce to one bit per pixel — and hands back a
`PrinterRaster` that can emit either command language:

```ts
import { PrinterImages, Xprinter } from 'react-native-xprint';

const raster = await PrinterImages.rasterize({
  source: 'file:///path/to/invoice.png', // also accepts content:// and plain paths
  widthDots: 560,          // 70 mm at 203 dpi (8 dots/mm)
  dithering: 'threshold',  // 'floydSteinberg' for photographs
  invert: false,
});

const printer = await Xprinter.connect(address);
await printer.write(raster.toTsplBitmap(0, 0));   // label printers
// or
await printer.write(raster.toEscPosRaster());     // receipt printers
```

The dots stay native until you ask for an encoding, so rasterizing an image you
do not end up printing costs no JS memory.

Use `'threshold'` for invoices, receipts, logos and barcodes — error diffusion
adds grain to line art and can make a barcode unscannable. Keep
`'floydSteinberg'` for photographs.

### Getting a label to land correctly

Two things have to be calibrated per printer, and both were verified on an
XP-P323B with 70 × 80 mm stock:

- **Orientation** — TSPL `DIRECTION` (0 or 1) sets the rotation and the corner
  the origin sits in. `rasterize` also takes `flipHorizontal` and `flipVertical`
  for cases where the mechanism needs a mirror rather than a rotation. On the
  XP-P323B, `DIRECTION 0` with no flips reads the right way up; its stored
  default is `1`, which is why an image with no explicit `DIRECTION` prints
  upside down.
- **Horizontal position** — the printable origin does not always line up with the
  paper's left edge, so a mathematically centered bitmap can still sit off to one
  side. Center it, then nudge with an offset: the XP-P323B needed −16 dots
  (−2 mm). `printImageAsLabel` in
  [`example/src/printJobs.ts`](example/src/printJobs.ts) does both, and
  `App.tsx` holds the calibration constants.

## Errors

Every method rejects with a message describing what the caller must fix — the
adapter is off, a permission is missing, the address is malformed, the printer is
out of range. Nothing fails silently.

## Architecture

[`docs/printer-core.md`](docs/printer-core.md) is the technical backbone: the
layer model (transport → session → encoders → documents → status), the objects in
each layer, thread ownership, the error rule, and the phased plan for getting
there. Read it before adding a transport, a command language, or a job type.

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
