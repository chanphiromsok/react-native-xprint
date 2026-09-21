# iOS implementation spec

How to replace the iOS stubs with a real implementation, and what it will cost.

Today every iOS entry point rejects with `UnsupportedPlatformError.bluetoothClassic`
and `XprinterBluetooth.isSupported` is hardcoded `false`
([`ios/HybridXprinterBluetooth.swift`](../ios/HybridXprinterBluetooth.swift)).
The stated reason — iOS does not hand Bluetooth Classic RFCOMM/SPP to
third-party apps — is correct and is not going to change. The conclusion drawn
from it, that XPrinter hardware is therefore out of reach on iOS, is **wrong for
the XP-P323B and for most of XPrinter's current line**, and this document exists
because the research below found the reason why.

This is a planning document. It contains no implementation, only the shape the
implementation should take, the platform facts it has to be built around, and
the order to build it in so each step can be checked against real hardware —
the same way the Android side was built (see
[printer-core.md §11](printer-core.md#11-phases)).

---

## 1. Feasibility summary

**Verdict: CoreBluetooth (BLE / GATT) is a real path, and it is the path
XPrinter itself uses.** MFi / ExternalAccessory is not required and is not what
the vendor ships. The work is a new L1 transport plus a Core Graphics port of
the raster pipeline; nothing above the transport boundary needs to move.

### What was verified

| Fact | Evidence | Confidence |
|---|---|---|
| XPrinter ships an official iOS SDK | Their download page lists **"iOS SDK v2.3.0"** alongside Android SDK 3.2.0, Windows and Linux SDKs. [xprintertech.com/download.html](https://www.xprintertech.com/download.html) | High |
| That SDK is **CoreBluetooth**, not MFi | `POSBLEManager.h` from `libPrinterSDK.a` imports `<CoreBluetooth/CoreBluetooth.h>` and its entire delegate surface is `CBPeripheral` / `CBCharacteristic` / `CBUUID`: `POSbleUpdatePeripheralList:RSSIList:`, `connectDevice:(CBPeripheral *)`, `writeCommandWithData:`, and settable `searchFilterUUID` / `characteristicUUID` properties. Mirrored in [anhnt224/x_printer `ios/PrinterSDK/Headers/POSBLEManager.h`](https://github.com/anhnt224/x_printer) and in a verbatim copy of the official v2.3.0 SDK+demo at [virtualspirit/react-native-network-printer](https://github.com/virtualspirit/react-native-network-printer) (`SDK/iOS SDK v2.3.0/v2.3.0(SDK + demo)/PrinterDemo/Printer/PrinterSDK/Headers/POSBLEManager.h`). | High |
| The vendor's own demo app is **not** an MFi app | The official v2.3.0 demo's `Info.plist` declares `NSBluetoothAlwaysUsageDescription` and contains **no** `UISupportedExternalAccessoryProtocols` key. An ExternalAccessory app cannot function without that key, so the vendor is not using MFi. | High |
| The XP-P323B radio is dual-mode | XPrinter's own product page lists **"Dual mode bluetooth"** for the XP-P323B. [xprintertech.com/xp-p323b](https://www.xprintertech.com/xp-p323b) | High |
| The BLE channel carries the same command languages | The sibling SDK exposes `writeCommandWithData:`, `writeTSCCommndWithData:` (TSC = TSPL) and `writePOSCommndWithData:` over the *same* write characteristic, and ships both `PosCommand` and `TscCommand` builders. [eatme-global/react-native-pos-thermal-printer `ios/Tools/BLEManager.m`](https://github.com/eatme-global/react-native-pos-thermal-printer) | Medium-high |
| The SDK models status exactly as this library does | `POSBLEManager`'s `printerCheck:(int)type` documents `type = 1` printer status, `2` offline, `3` error, `4` paper feed — the same `DLE EOT n` subsystem split as [`StatusQueryPlan.kt`](../android/src/main/java/com/margelo/nitro/xprinter/StatusQueryPlan.kt). The existing ESC/POS status parsing ports unchanged. | High |

### What is assumed, not verified

| Assumption | Why it is unverified | How to close it |
|---|---|---|
| **The specific GATT service/characteristic UUIDs on an XP-P323B.** | The official SDK compiles them into `libPrinterSDK.a`; `searchFilterUUID` and `characteristicUUID` are *settable*, which is itself evidence the vendor does not consider them fixed. The open-source sibling SDK filters discovery on advertised 16-bit services **`18F0`** and **`FFF0`** (its own comment: *portable printers are `FFF0`*), and carries commented-out constants for the ISSC "transparent UART" triple — service `49535343-FE7D-4AE5-8FA9-9FAFD205E455`, write `49535343-8841-43F4-A8D4-ECBE34729BB3`, notify `49535343-1E4D-4BD9-BA61-23C647249616` — the same triple documented for the [KT6368A dual-mode module](https://dev.to/ble_voice/solution-for-thermal-printers-using-the-kt6368a-dual-mode-bluetooth-chip-module-33hm) used in this class of printer. Three plausible UUID families, no ground truth for *this* unit. | **Phase 1 discovers rather than assumes** — see §4.2. Do not hardcode a UUID list as the primary path. |
| **That the XP-P323B advertises over BLE while idle.** "Dual mode" guarantees the radio does both; it does not guarantee the BLE side advertises a connectable, writable serial service rather than existing only for a pairing handshake. | No BLE sniff of the actual unit. | Phase 1's first deliverable is a scan log. If the printer never appears, everything downstream is moot for this model. |
| **That TSPL over the BLE characteristic behaves identically to TSPL over SPP.** | Evidence is the vendor SDK's API shape, not a measured print. | Phase 1 acceptance: a TSPL calibration label printed over BLE that matches the one printed over SPP. |

### The honest summary

For the XP-P323B specifically, the probability that a CoreBluetooth transport
works is high, and the single unresolved question is which UUIDs the unit
exposes — which a discovery-driven implementation does not need to know in
advance. **Across XPrinter's catalogue it is model-dependent**, and this
library should say so rather than promising blanket iOS support: a Classic-only
board has no iOS path at all, from this library or from XPrinter's own SDK.
`isSupported` stays meaningful on iOS — it just stops being a compile-time
`false` and becomes "this device has a usable BLE radio", with per-printer
reachability discovered at scan time.

---

## 2. What changes at the API boundary

The `.nitro.ts` specs do not change. Five things change *meaning* underneath
them, and every one is a documentation obligation rather than a signature
change. **None of these require the user's sign-off on a spec change** — but
§2.6 does.

### 2.1 `address` stops being a MAC address

`BluetoothDeviceInfo.address` is documented as "the device's MAC address, e.g.
`'66:32:10:B2:A1:0C'`". CoreBluetooth never exposes a peripheral's hardware
address. The only stable handle is `CBPeripheral.identifier`, a `UUID` that is
**derived per-app-installation and per-device** — the same printer has a
different identifier in a different app, and on a different phone, and after a
reinstall.

The field stays a `string` and `connect(address:)` keeps its signature. On iOS
it carries `peripheral.identifier.uuidString`. Consequences the docs must state:

- A saved `address` is a **platform-local token**, not a device identity. An app
  that syncs its `SavedPrinter` list across a user's devices (as the reference
  `PrinterStorage` in [driver-app-integration.md](driver-app-integration.md)
  invites) will hand an iPhone an identifier that resolves to nothing.
- `Xprinter.connect(address)` on iOS must go through
  `centralManager.retrievePeripherals(withIdentifiers:)` before falling back to
  a scan, and must reject with a message naming *that* failure mode — "this
  printer was set up on another device; set it up again here" — not "unknown
  address".
- `BluetoothAdapter.checkBluetoothAddress`-style validation becomes
  `UUID(uuidString:)` validation.

### 2.2 `getBondedDevices()` has no direct analogue

There is no Classic bond list to read. The closest honest mapping, in order:

1. `retrievePeripherals(withIdentifiers:)` for identifiers this app has seen
   before (the app must persist them — CoreBluetooth does not).
2. `retrieveConnectedPeripherals(withServices:)` for peripherals **another app
   or the system** already has connected. The sibling SDK does exactly this with
   `18F0` and `FFF0`.

Neither is "paired in system settings". `BluetoothDeviceInfo.isBonded` should
report `true` only for a peripheral in `.connected` state or one successfully
retrieved by identifier, and the field's doc comment needs an `@platform ios`
note. The fast-path promise in the spec ("a printer paired once in the system
Bluetooth settings shows up here without running a scan") is simply false on
iOS and must be qualified.

### 2.3 `startDiscovery()` does not stop itself

The spec says "Android stops discovery by itself after about 12 seconds, which
is reported through `addDiscoveryStateListener`". `CBCentralManager.scanForPeripherals`
runs until told to stop. To keep one contract, the iOS session **must impose its
own deadline** and emit the same `isDiscovering → false` transition. Pick 12
seconds to match, and say in the doc comment that the figure is Android's
hardware timeout and iOS's deliberate imitation of it.

Scanning also drains battery in a way Classic discovery's fixed window does not,
so an un-stopped scan is a worse bug on iOS than on Android. The deadline is not
a nicety.

### 2.4 `majorDeviceClass` has no source

Class of Device is a Bluetooth Classic concept carried in the inquiry response.
BLE advertisements have no equivalent. `majorDeviceClass` is always
`'uncategorized'` on iOS. That is already the enum's documented fallback, so no
type changes — but any UI that filters a device list by
`majorDeviceClass === 'imaging'` will show nothing on iOS, and the example app
should be checked for exactly that.

`rssi`, by contrast, is *better* on iOS: it arrives on every advertisement, so
it can be refreshed continuously during a scan rather than captured once.

### 2.5 `write()` acquires a chunk size the caller can feel

Covered in full in §4.4. Summary: SPP has no per-write ceiling and the Android
side chunks at 512 bytes purely to pace the print head. BLE has a hard
per-write ceiling of `maximumWriteValueLength(for:)` — typically 20 bytes on an
un-negotiated link, 182–512 on a modern one — and a full-width label raster is
tens of kilobytes. This is a real throughput difference, not just an
implementation detail, and it belongs in the README next to the iOS caveat it
replaces.

### 2.6 The one genuine spec question: `permissionStatus`

`BluetoothPermissionStatus` is `'granted' | 'denied' | 'blocked'`, with
`permissionStatus` documented as never reporting `'blocked'` and
`requestPermissions()` documented as prompting.

CoreBluetooth has **no request API**. The system prompt fires the first time a
`CBCentralManager` is instantiated with a delegate, once per install, and the
app cannot trigger it a second time. `CBManager.authorization` reports
`.notDetermined` / `.restricted` / `.denied` / `.allowedAlways`.

The mapping that preserves the existing contract:

| `CBManager.authorization` | `permissionStatus` (sync) | `requestPermissions()` result |
|---|---|---|
| `.notDetermined` | `'denied'` | instantiate the central, await the first `centralManagerDidUpdateState`, then re-read |
| `.allowedAlways` | `'granted'` | `'granted'` |
| `.denied` | `'denied'` | `'blocked'` |
| `.restricted` | `'denied'` | `'blocked'` |

This works, and it keeps the documented "`permissionStatus` never reports
`'blocked'`" invariant. It has one behavioural wrinkle the spec does not
currently anticipate and which **should be raised with the user before
implementation**: on iOS, `requestPermissions()` prompts *only the first time* —
on every later call with `.denied` it resolves `'blocked'` immediately with no
UI. That matches how `'blocked'` is already documented ("send the user to the
app's system settings instead"), so the recommendation is to **keep the spec
unchanged** and document the difference. Flagging it here because it is the one
place where iOS semantics are a squeeze rather than a clean fit.

A related ordering trap: `isEnabled` needs `centralManager.state == .poweredOn`,
but instantiating the central is what triggers the permission prompt. A cold
`Xprinter.isEnabled` read would therefore prompt as a side effect of a getter.
Instantiate the central lazily on the first *action* (`requestPermissions`,
`startDiscovery`, `getBondedDevices`, `connect`), and have `isEnabled` report
`false` — not prompt — while no central exists.

### 2.7 A build break to fix on the way past

The current stub `HybridPrinterImageFactory` implements only `rasterize`.
`HybridPrinterImageFactorySpec` (nitrogen-generated,
`nitrogen/generated/ios/swift/HybridPrinterImageFactorySpec.swift:17`) also
declares `countPages(source:)`. The iOS target does not currently satisfy its
own generated protocol. Phase 3 fixes this properly; if an iOS build is needed
before then, the stub needs a rejecting `countPages` added.

---

## 3. Target architecture

`Hybrid*` files stay orchestration; preflight, conversions and platform helpers
live in their own named files — the same rule
[printer-core.md §10](printer-core.md#10-file-layout) sets for Kotlin.

### 3.1 File map

| Android / Kotlin | iOS / Swift | Responsibility of the Swift file |
|---|---|---|
| `HybridXprinterBluetooth.kt` | `ios/HybridXprinterBluetooth.swift` **(replaces the stub)** | Orchestration only. Owns the `BluetoothCentral`, exposes `isSupported`/`isEnabled`/`isDiscovering`/`permissionStatus`, forwards discovery and connect. |
| `HybridBluetoothPrinter.kt` | `ios/HybridBluetoothPrinter.swift` **(new)** | One connected peripheral: `write`/`read`/`detectLanguage`/`readStatus`/`disconnect`, plus the `calibration`/`media`/`language` state. Ports the Kotlin logic almost line for line; only the byte-delivery calls differ. |
| `BluetoothDiscoverySession.kt` | `ios/BluetoothDiscoverySession.swift` **(new)** | Scan lifecycle, the self-imposed 12 s deadline, dedup, and the two listener registries. Replaces the `BroadcastReceiver` with `CBCentralManagerDelegate` callbacks. |
| `BluetoothPermissions.kt` | `ios/BluetoothPermissions.swift` **(new)** | `CBManager.authorization` → `BluetoothPermissionStatus`, and the one-shot "wait for the first state callback" continuation. |
| `BluetoothPreflight.kt` | `ios/BluetoothPreflight.swift` **(new)** | The guard: central exists, authorization is `.allowedAlways`, `state == .poweredOn`. Same job, same error-message-names-the-fix rule. |
| *(no counterpart — new)* | `ios/PrinterPeripheralLink.swift` **(new)** | The CoreBluetooth transport proper: characteristic resolution, the serial write queue, chunking, the notify inbox, and `CBPeripheralDelegate`. **This is where all the platform difficulty is concentrated.** Keeping it out of `HybridBluetoothPrinter` is what lets that file stay a port of the Kotlin. |
| `extension/BluetoothDevice+openSppSocket.kt` | `ios/BluetoothCentral+connect.swift` **(new)** | Connect + service/characteristic discovery, bridged to `async` and bounded by a timeout. The SPP secure-then-insecure retry has no BLE analogue and disappears. |
| `extension/BluetoothDevice+toDeviceInfo.kt` | `ios/CBPeripheral+toDeviceInfo.swift` **(new)** | `CBPeripheral` + advertisement + RSSI → `BluetoothDeviceInfo`, per §2.1/§2.2/§2.4. |
| `extension/BluetoothMajorDeviceClass+fromAndroidMajorDeviceClass.kt` | *(dropped)* | No Class of Device on BLE; the conversion has no input. |
| `extension/Intent+bluetoothDeviceExtra.kt` | *(dropped)* | No broadcasts. |
| `ListenerRegistry.kt` | `ios/ListenerRegistry.swift` **(new)** | Identical design — id-keyed map, add returns a remover. Back it with a lock or an actor rather than `ConcurrentHashMap`. |
| `PrinterDefaults.kt` | `ios/PrinterDefaults.swift` **(new)** | The same 203 dpi / 72 mm / no-offset defaults. Pure value code, direct port. |
| `LanguageProbePlan.kt` | `ios/LanguageProbePlan.swift` **(new)** | Byte-for-byte port. `REPLY_TIMEOUT_MS = 700` should be **re-measured on BLE**, not assumed — see §8. |
| `StatusQueryPlan.kt` | `ios/StatusQueryPlan.swift` **(new)** | Byte-for-byte port, same timeout caveat. |
| `extension/Byte+toTsplStatus.kt` | `ios/UInt8+toTsplStatus.swift` **(new)** | Pure byte→struct mapping. Direct port; no platform content at all. |
| `extension/ByteArray+toEscPosStatus.kt` | `ios/Data+toEscPosStatus.swift` **(new)** | Direct port, including the per-byte validity gate. |
| `extension/Byte+isValidEscPosStatusByte.kt` | `ios/UInt8+isValidEscPosStatusByte.swift` **(new)** | Direct port (`0x93` mask, `0x12` pattern). |
| `extension/ByteArray+toPrintableAscii.kt` | `ios/Data+toPrintableAscii.swift` **(new)** | Direct port. |
| `HybridPrinterImageFactory.kt` | `ios/HybridPrinterImageFactory.swift` **(replaces the stub)** | `rasterize` + the currently-missing `countPages`, on a background queue. |
| `HybridPrinterRaster.kt` | `ios/HybridPrinterRaster.swift` **(new)** | Holds a `MonochromeRaster`, reports `memorySize`, encodes on demand. Direct port. |
| `MonochromeRaster.kt` | `ios/MonochromeRaster.swift` **(new)** | The 1-bpp container and its `rowBytes` invariant. Direct port. |
| `MonochromeRasterizer.kt` | `ios/MonochromeRasterizer.swift` **(new)** | Fit → scale/flip → luminance → dither → pack, on Core Graphics. §6.2. |
| `PdfPageRenderer.kt` | `ios/PdfPageRenderer.swift` **(new)** | PDFKit/`CGPDFDocument` render, plus the `trimToContent` probe-and-crop. §6.1. |
| `SourceFiles.kt` | `ios/SourceFiles.swift` **(new)** | Path / `file://` / `ph://` resolution and `%PDF` magic-byte sniffing. §6.3. |
| `SourceImageLoader.kt` | `ios/SourceImageLoader.swift` **(new)** | Bitmap decode via `CGImageSource`. §6.3. |
| `extension/MonochromeRaster+toTsplBitmap.kt` | `ios/MonochromeRaster+toTsplBitmap.swift` **(new)** | §7.1. |
| `extension/MonochromeRaster+toEscPosRaster.kt` | `ios/MonochromeRaster+toEscPosRaster.swift` **(new)** | §7.2. |
| `XprinterPackage.kt` | *(no counterpart)* | Autolinking is already generated for iOS (`nitrogen/generated/ios/XprinterAutolinking.swift`); `nitro.json` already names both iOS implementation classes. No registration work. |
| *(no counterpart — new)* | `ios/UnsupportedPlatformError.swift` **(rewritten)** | Becomes the "this printer has no BLE serial service" / "this device has no Bluetooth" error set. The `.bluetoothClassic` case is retired. |

`Xprinter.podspec` already globs `ios/**/*.{swift}`, so new files need no podspec
change. `CoreBluetooth`, `PDFKit`, `CoreGraphics`, `ImageIO` and `Accelerate` are
all system frameworks and are linked implicitly by `import`.

### 3.2 Layer boundaries

This exercises the L1/L2 boundary the architecture claims to have
([printer-core.md §12](printer-core.md#12-decisions-still-open): *"If iOS
support is ever needed it will be a BLE or MFi transport at L1, and L2 upward
should be unaffected — which is a useful test of whether the transport boundary
is honest"*). The test result, from this mapping: **mostly honest, with one
leak**. Everything from `detectLanguage` upward ports unchanged. The leak is
chunk size — currently a `private const val CHUNK_SIZE = 512` inside
`HybridBluetoothPrinter`, which on iOS has to become a value the transport
negotiates at connect time. That is the boundary telling you chunking belongs to
the transport, exactly as §3 of printer-core already says it should.

---

## 4. CoreBluetooth transport design

### 4.1 Lifecycle mapping

| Android (SPP) | iOS (CoreBluetooth) |
|---|---|
| `BluetoothManager.adapter` | `CBCentralManager(delegate:queue:)` — lazily created (§2.6) |
| `adapter.isEnabled` | `central.state == .poweredOn` |
| `adapter.startDiscovery()` + `ACTION_FOUND` broadcast | `scanForPeripherals(withServices:options:)` + `centralManager(_:didDiscover:advertisementData:rssi:)` |
| `ACTION_DISCOVERY_FINISHED` (OS-driven, ~12 s) | `stopScan()` from our own 12 s deadline (§2.3) |
| `adapter.cancelDiscovery()` before connect | `stopScan()` before connect — **same reason, same severity**: an active scan starves the connection interval |
| `adapter.getRemoteDevice(mac)` | `retrievePeripherals(withIdentifiers:)`, else the scan cache |
| `device.createRfcommSocketToServiceRecord(SPP_UUID)` + `socket.connect()` | `central.connect(peripheral)` → `didConnect` → `discoverServices` → `didDiscoverServices` → `discoverCharacteristics` → `didDiscoverCharacteristicsFor` |
| secure-then-insecure retry | *(no analogue; BLE has no equivalent channel choice)* |
| `socket.outputStream.write` + `flush` | `peripheral.writeValue(_:for:type:)` |
| `socket.inputStream.available()` / `read` | `setNotifyValue(true, for:)` → `peripheral(_:didUpdateValueFor:error:)` |
| `socket.close()` | `central.cancelPeripheralConnection(peripheral)` |
| `socket.isConnected` | `peripheral.state == .connected` **and** a resolved write characteristic |

Note the last row. On SPP, a connected socket *is* a usable pipe. On BLE, a
connected peripheral with no writable characteristic is useless, so
`isConnected` must mean "connected **and** the serial channel is resolved" or
`write()` will reject on a connection the caller was told is open.

### 4.2 Characteristic resolution — discover, do not hardcode

The sibling vendor SDK gets this wrong twice, and both mistakes are instructive.

Its discovery filter only accepts peripherals advertising `18F0` or `FFF0`
(`BLEManager.m:212`), which silently hides any printer whose module advertises
the ISSC service instead — a limitation its own commented-out code
acknowledges. And its characteristic selection reads:

```objc
if ((CBCharacteristicPropertyWrite && properties) || (CBCharacteristicPropertyWriteWithoutResponse && properties)) {
    write_characteristic = aChar;
}
```

`&&` where `&` was meant. Every constant is non-zero and `properties` is
non-zero, so the condition is always true and `write_characteristic` ends up
being whichever characteristic happened to be enumerated last. It works only
because these modules expose few characteristics.

The design here should instead be, in order:

1. **Scan with `withServices: nil`.** Filtering by service UUID at scan time is
   the efficient option, but only when the UUID is known — and per §1 it is not.
   An unfiltered scan sees every peripheral; rank the results rather than hide
   them.
2. **Rank candidates** by: advertised service UUID matching the known families
   (`18F0`, `FFF0`, `49535343-FE7D-4AE5-8FA9-9FAFD205E455`), then by
   `CBAdvertisementDataLocalNameKey` matching a printer-name heuristic
   (`XP-`, `Printer`, `BlueTooth Printer`). Report **all** peripherals through
   `addDeviceFoundListener` — hiding one is how a user with an unlisted model
   concludes the library is broken.
3. **After connecting, discover all services and all characteristics**, then
   pick the write characteristic by *actual properties*
   (`properties.contains(.writeWithoutResponse)` preferred, else
   `.contains(.write)`) and the notify characteristic by
   `.contains(.notify)`. Prefer a candidate pair inside one of the known service
   families when several services qualify; fall back to the only pair that does.
4. **Reject with a specific error** when no writable characteristic exists
   anywhere on the peripheral: *"This printer is reachable over Bluetooth LE but
   exposes no writable serial service. It may be a Bluetooth Classic-only model,
   which iOS cannot reach."* That sentence is the honest terminal state for the
   no-iOS-path hardware in §1, and it names the fix (use Android) rather than
   the fault.

Hardcode nothing. Log the resolved UUIDs at debug level — on first contact with
a new model that log is the whole diagnosis.

### 4.3 Serialization: writes complete in call order

`BluetoothPrinter.write()` promises "Writes are serialized in call order on the
connection's own thread, so consecutive writes cannot interleave on the wire",
and `read()` promises to be serialized with `write` so that a write-then-read is
a query and its reply. On Android a single-threaded executor delivers both for
free. CoreBluetooth is delegate-callback-driven on a dispatch queue, so the
guarantee has to be built.

**Shape: one `actor` per connection, plus continuation-based bridging.**

- The `CBCentralManager` and every `CBPeripheral` get a dedicated serial
  `DispatchQueue` (passed to the `CBCentralManager` initialiser), not
  `.main` — this is the direct equivalent of the Kotlin's
  `Executors.newSingleThreadExecutor` and keeps rasterized payloads off the UI
  thread.
- A `PrinterPeripheralLink` **actor** owns: the resolved characteristics, the
  in-flight write continuation, the pending-read deadline, and the notify inbox
  buffer. Actor isolation gives the "one owner" property that
  [printer-core.md §8](printer-core.md#threading-and-ownership) requires, and
  `await` gives call-order serialization without an explicit queue.
- Delegate callbacks arrive on the CB queue and are forwarded into the actor
  with a single `Task { await link.handle(...) }` hop. **One hop, at the
  boundary** — the same rule the Kotlin follows.

Sketch of the write path, illustrative only:

```swift
// inside actor PrinterPeripheralLink
func write(_ data: Data) async throws {
  for chunk in data.chunked(into: chunkSize) {
    try await writeOneChunk(chunk)     // suspends; the next loop turn cannot start early
  }
}

private func writeOneChunk(_ chunk: Data) async throws {
  try await withCheckedThrowingContinuation { continuation in
    pendingWrite = continuation
    peripheral.writeValue(chunk, for: writeCharacteristic, type: .withResponse)
  }
}

// delegate, forwarded in: peripheral(_:didWriteValueFor:error:)
func didWrite(error: Error?) {
  let continuation = pendingWrite
  pendingWrite = nil
  if let error { continuation?.resume(throwing: error) } else { continuation?.resume() }
}
```

Two hazards to get right, because both produce crashes rather than wrong
answers:

- **A continuation must be resumed exactly once.** A disconnect that lands
  between `writeValue` and `didWriteValueFor` must resume the pending
  continuation with an error — the actor's disconnect path owns that, just as
  the Kotlin's `close()` owns unblocking a stalled socket write.
- **A continuation must not leak on timeout.** Wrap each chunk in a bounded
  race (a `Task` group with a sleeping sibling) so a printer that goes silent
  mid-job fails the promise rather than hanging it forever. SPP writes could
  block indefinitely too, but there the OS eventually errored the socket; here
  nothing will.

`read()` uses the same actor: the notify handler appends to an inbox `Data`, and
`read(maxBytes:timeoutMs:)` awaits either `inbox.count >= maxBytes` or the
deadline, then drains and returns whatever is there. This reproduces
`readWithin`'s semantics — *return what arrived, empty is a legitimate answer* —
without `readWithin`'s 10 ms poll loop, which existed only because
`BluetoothSocket`'s input stream has no timeout. **The polling loop should not
be ported.** A `CheckedContinuation` resumed either by the notify callback or by
a timer is strictly better, and the Kotlin comment explaining the poll makes
clear it was a workaround, not a design.

One thing the notify model gives you that SPP did not: bytes can arrive when
nobody is reading. The inbox must therefore be **cleared at the start of each
read**, or an unsolicited status byte from a previous command gets spliced onto
the next reply — precisely the failure `isValidEscPosStatusByte` was written to
catch. Clearing on read entry is cheaper than relying on that gate.

### 4.4 Chunking and flow control — the real behavioural difference

This is where iOS is genuinely not Android, and the README needs to say so.

**Android/SPP:** `stream.write(bytes, offset, length)` accepts any length. The
512-byte chunk in `HybridBluetoothPrinter.writeInChunks` is *pacing*, not a
limit — its comment says so: a single 45 KB write stalls until the head has
burned every dot, whereas chunks flow steadily. The chunk size is a constant
because RFCOMM's frame payload is a constant.

**iOS/BLE:** `writeValue(_:for:type:)` has a hard per-call ceiling from
[`maximumWriteValueLength(for:)`](https://developer.apple.com/documentation/corebluetooth/cbperipheral/maximumwritevaluelength(for:)).
Data longer than that is **silently truncated** for `.withoutResponse` and
errors for `.withResponse`. The value is negotiated per connection: 20 bytes on
an ATT_MTU-23 link, up to 512 on a modern one, and it differs between the two
write types. So:

- **Query it at connect time**, store it on the link, and use it as the chunk
  size. Never hardcode 512 (the vendor SDK's `oneTimeBytes = 20000` is exactly
  the truncation bug this avoids), and never hardcode 20 either — capping a 45 KB
  raster at 20 bytes per write is roughly 2,300 round trips.
- **Prefer `.withResponse`.** It is slower per packet but each write is
  acknowledged, which *is* the backpressure that keeps the print head from being
  overrun — the same property the Android chunking was reaching for, delivered by
  the link layer instead of by a blocking socket. It also makes the continuation
  design above correct by construction, because `didWriteValueFor` only fires for
  `.withResponse`.
- **If `.withResponse` proves too slow on real hardware**, the fallback is
  `.withoutResponse` gated on `peripheral.canSendWriteWithoutResponse` and the
  `peripheralIsReady(toSendWriteWithoutResponse:)` callback. Do **not** fire
  `.withoutResponse` writes in an unthrottled loop — that is how these SDKs drop
  the middle of a label. Measure before switching; a first implementation should
  be `.withResponse` only.

**Expected throughput, and why it matters to the product.** A 560×800-dot label
raster is `70 × 800 = 56 000` bytes. At a 182-byte MTU that is ~308 writes; at
the ~7.5 ms minimum connection interval iOS typically negotiates, and one write
per interval, that is **2–3 seconds of transfer** before the printer starts
producing paper — against a fraction of a second over SPP. A 20-byte MTU makes
it ~20 seconds, which is not shippable. **Log the negotiated MTU on every
connection**; it is the single number that predicts whether iOS printing feels
acceptable on a given phone/printer pair, and it is the first thing to check
when someone reports iOS being slow.

Two mitigations worth knowing, neither of which is in scope for Phase 1:

- The ESC/POS `GS v 0` payload compresses well (long runs of `0x00`), but
  neither ESC/POS nor TSPL defines a compressed raster this library could rely
  on across models. The vendor SDK's `compressionImagedata:` hints that some
  firmware supports one; treat as unverified.
- Reducing `widthDots` reduces bytes quadratically-ish. A driver app that prints
  4×6 labels at 203 dpi has no headroom to give, but one printing a small
  receipt logo does.

### 4.5 Disconnect and failure

`disconnect()` must be callable from any thread and must resolve even if a write
is in flight — the Kotlin achieves this by closing the socket from the *calling*
thread, which is the only way to unblock a blocked `BluetoothSocket`. The Swift
equivalent is simpler: `cancelPeripheralConnection` is safe to call any time, and
the actor's `didDisconnect` handler resumes any pending write/read continuation
with an error and flips `isConnected`.

`centralManager(_:didDisconnectPeripheral:error:)` also fires **unsolicited** —
printer powered off, moved out of range. Android learns this only when a write
fails. On iOS the connection reports its own death, which is strictly better
information; route it to the same place (`isConnected = false`) so the two
platforms behave identically from JS, and consider it groundwork for the
"reconnect on printer power-cycle" item that
[driver-app-integration.md](driver-app-integration.md#what-is-not-built-yet)
lists as not built.

---

## 5. Permissions and `Info.plist`

### 5.1 Keys

| Key | Required | Notes |
|---|---|---|
| `NSBluetoothAlwaysUsageDescription` | **Yes**, iOS 13+ | Missing it is not a rejected permission — the app **crashes** the moment a `CBCentralManager` is created. XPrinter's own v2.3.0 demo declares exactly this key and nothing else. |
| `NSBluetoothPeripheralUsageDescription` | Only if deploying below iOS 13 | This library's minimum is whatever `min_ios_version_supported` resolves to in the host app; add it only if that is < 13. |
| `UIBackgroundModes: bluetooth-central` | **No** | Printing is foreground work. Adding it invites App Review questions and a battery cost for nothing. Explicitly out of scope. |
| `UISupportedExternalAccessoryProtocols` | **No** | Not an MFi accessory (§1). |

Unlike Android — where this library declares `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`
in its own manifest and they merge into the app's — **a CocoaPods pod cannot
inject `Info.plist` keys into the host app.** The key must be added by the
integrator. That means:

- The README gains an iOS installation section with the key, an example string,
  and the "otherwise your app crashes on first scan" warning. This is the single
  most likely integration failure and deserves to be impossible to miss.
- Consider shipping an Expo config plugin (`app.plugin.js`) that adds the key,
  since the example app is Expo prebuild-based. Optional for Phase 1, strongly
  recommended before release.

### 5.2 Mapping onto the existing semantics

Covered in §2.6. The shape of `BluetoothPreflight.swift` mirrors
`BluetoothPreflight.kt` exactly — one guard, three checks, each throwing an
error that names the fix:

| `BluetoothPreflight.kt` | `BluetoothPreflight.swift` | Message must say |
|---|---|---|
| no adapter → `UnsupportedOperationException` | `CBManager.authorization == .restricted`, or no BLE hardware | "This device cannot use Bluetooth LE." |
| missing runtime permission → `SecurityException` | `authorization != .allowedAlways` | "Call `Xprinter.requestPermissions()` first." / for `.denied`: "Bluetooth access was turned off for this app. Re-enable it in Settings." |
| `!adapter.isEnabled` → `IllegalStateException` | `central.state != .poweredOn` | "Bluetooth is turned off. Ask the user to enable it before scanning or connecting." — **identical string to Android**, deliberately. |

`central.state` distinguishes `.unsupported` (simulator, or hardware without
BLE) from `.poweredOff` from `.unauthorized`. Use all three; collapsing them
into one message is how an operator ends up toggling Bluetooth to fix a
permission problem.

**The simulator has no Bluetooth.** `state` is `.unsupported` there, so
`isSupported` is `false` and every Bluetooth path is untestable in the
simulator. The rasterization work (§6) is fully simulator-testable; the
transport work is not. This shapes the phasing in §9.

---

## 6. Rasterization on iOS

This half has no platform risk. It is a mechanical port from
`android.graphics` to Core Graphics, and it can be built and verified without a
printer by comparing output bytes against the Android implementation.

### 6.1 `PdfPageRenderer.kt` → `ios/PdfPageRenderer.swift`

`PDFKit`'s `PDFDocument`/`PDFPage` is the closest analogue to `PdfRenderer`
(page count, and a `draw(with:to:)` that respects a CTM), and is available on
iOS 11+. `CGPDFDocument` is the lower-level alternative and is preferable here
for one reason: `CGPDFPage.getBoxRect(.cropBox)` gives the page box in points
directly, and `CGPDFPage.getDrawingTransform` handles the box/rotation
normalisation that PDFKit hides. Either works; the notes below are written for
`CGPDFDocument` and translate trivially.

The port, piece by piece:

| Kotlin | Swift |
|---|---|
| `PdfRenderer(descriptor).pageCount` | `CGPDFDocument(url).numberOfPages` |
| `renderer.openPage(i)` | `document.page(at: i + 1)` — **1-based**; the off-by-one is the single most likely bug in this file |
| `page.width` / `page.height` (points) | `page.getBoxRect(.cropBox).size` |
| `createBitmap(w, h)` + `eraseColor(Color.WHITE)` | `CGContext(data: nil, width:height:bitsPerComponent: 8, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: none)` then `setFillColor(.white)` + `fill(bounds)` |
| `Matrix().postTranslate(-l, -t).postScale(sx, sy)` | `context.translateBy` / `context.scaleBy` — **note the Y flip** |
| `page.render(bitmap, null, matrix, RENDER_MODE_FOR_PRINT)` | `context.drawPDFPage(page)` |

**Erase to white first, always.** The Kotlin comment is not optional advice —
a `CGContext` allocated with `data: nil` is zero-filled, and zero in a grayscale
context is **black**. An un-erased context makes every PDF print as a solid
black label. This is the same trap, with the same consequence, as on Android.

**The Y flip.** `PdfRenderer` renders top-down into a bitmap; Core Graphics PDF
space is bottom-up. The crop-and-fit matrix therefore needs an extra
`translateBy(x: 0, y: height); scaleBy(x: 1, y: -1)` relative to the Kotlin,
**or** the crop rect's `top`/`bottom` must be computed from the bottom edge.
Pick one and write down which — getting this wrong produces a vertically
mirrored label that looks almost plausible, which is worse than one that looks
obviously broken.

**Port `trimToContent` faithfully, including its constants.** The algorithm is
the trickiest thing in the Android codebase and every constant in it is load
bearing:

1. Render a probe at `PROBE_WIDTH_PX = 300` wide, height derived by
   `round(pageHeight * 300 / pageWidth)` and floored at 1.
2. Read all probe pixels. A pixel is ink if **any** channel is
   `< CONTENT_LUMINANCE_THRESHOLD = 250`. *(In a grayscale context there is one
   channel, so "any channel" collapses to a single comparison — an intentional
   simplification, not a deviation, since the RGB test was per-channel `OR`.)*
3. Track `minX/minY/maxX/maxY` over ink pixels.
4. **No ink at all → return the whole page.** A blank page has nothing to trim
   to, and collapsing to a zero-size crop divides by zero downstream.
5. Pad by `CONTENT_PADDING_PX = 1` probe pixel, clamped to the probe bounds.
6. Convert back to points with **separate X and Y ratios**
   (`pageWidth / probeWidth`, `pageHeight / probeHeight`). The Kotlin has a
   comment explaining exactly why: `probeHeight` was rounded, so the two axes'
   scales are only approximately equal and one shared ratio injects an
   aspect-ratio error into the crop. Port the comment too.
7. Right/bottom edges are `(clamped_max + 1) * ratio` — the `+ 1` makes the rect
   cover the ink pixel rather than stop at its top-left corner. Easy to drop.

Then the fit: width is `targetWidthDots`, height is
`max(1, round(contentHeightPt * width / contentWidthPt))`; if `maxHeightDots` is
exceeded, height wins and width is recomputed. Same as Kotlin.

**Render once, at the final size.** The reason is in the Kotlin's doc comment
and is worth restating because it is the whole point of this file existing
rather than routing PDFs through the image path: a PDF is vector art, so one
render at the target dot size keeps text and barcode bars as crisp as a 203 dpi
head can reproduce. Rendering large and letting the rasterizer scale down
resamples twice before dithering ever sees the image.

### 6.2 `MonochromeRasterizer.kt` → `ios/MonochromeRasterizer.swift`

Same five stages: `fitWithin` → `scaleAndFlip` → `luminanceOf` → optional
`diffuseError` → `pack`.

- `fitWithin`, `heightFor`: pure integer arithmetic. Direct port. Keep the
  `max(1, ...)` floors — they are what stops a wide, short image rounding to
  zero height.
- `scaleAndFlip`: draw the source `CGImage` into a
  `widthDots × heightDots` grayscale `CGContext` with a CTM carrying the
  negative scale factors. `context.interpolationQuality = .high` is the
  equivalent of `Bitmap.createBitmap(..., filter = true)`. One draw does scale
  and mirror together, as on Android.
- `luminanceOf`: Rec. 601 weights `(r*299 + g*587 + b*114) / 1000`, then
  composite over white as `(grey * alpha + 255 * (255 - alpha)) / 255`, then
  invert if asked. **Do not delegate this to a grayscale `CGColorSpace`
  conversion** — Core Graphics uses different (and colour-managed) weights, and
  the output would diverge from Android for the same input. Render into an
  **RGBA8** context and compute luminance by hand with the same integer
  arithmetic, so both platforms produce identical dot data for identical input.
  That byte-identity is what makes Phase 3 verifiable without a printer (§9).
  Compositing over white can be had for free by filling the context white before
  drawing; keep the explicit alpha maths anyway so a premultiplied source cannot
  drift.
- `diffuseError` (Floyd–Steinberg): direct port, including the **integer**
  division (`error * 7 / 16`, etc.) and the exact traversal order. Floating-point
  or a different neighbour order gives a visually similar but byte-different
  result, which breaks the cross-platform comparison.
- `pack`: `rowBytes = (width + 7) / 8`, MSB leftmost, a set bit meaning black.
  Direct port.

`vImage` (Accelerate) can do the scale and the grayscale conversion faster, and
is worth considering later for large images. It is **not** worth it in the first
implementation: it would make byte-for-byte comparison against Android harder at
exactly the moment that comparison is the acceptance test.

### 6.3 `SourceFiles.kt` / `SourceImageLoader.kt`

- **Magic-byte detection stays.** `%PDF` (`25 50 44 46`), read from the first
  four bytes. The Kotlin's reasoning — a picker URI has no usable name and
  `printToFileAsync` output gets renamed — is if anything stronger on iOS, where
  `UIDocumentPicker` and `PHPicker` hand back opaque URLs.
- **URI schemes differ.** Android handles plain paths, `file://` and
  `content://`. iOS needs plain paths, `file://`, and **security-scoped URLs**
  from the document picker, which require
  `startAccessingSecurityScopedResource()` / `stopAccessingSecurityScopedResource()`
  around every read or the read fails with a permissions error that looks like a
  missing file. `ph://` (Photos) is a further case; decide whether to support it
  or reject it with a message telling the caller to copy the asset to a temp
  file first. **Recommendation: reject `ph://` in Phase 3** — supporting it drags
  in `PHImageManager` and a photo-library permission this library otherwise does
  not need.
- Image decode: `CGImageSourceCreateWithURL` + `CGImageSourceCreateImageAtIndex`
  covers PNG, JPEG, HEIC and WebP (iOS 14+). Failure message should name the
  same accepted formats the Kotlin does.

---

## 7. TSPL / ESC-POS encoding

Both are pure byte manipulation with no platform surface. Port literally;
resist tidying.

### 7.1 `toTsplBitmap(xDots:yDots:)`

```
"BITMAP {x},{y},{rowBytes},{heightDots},0," (US-ASCII)
  + every raster byte bitwise-inverted
  + "\r\n"
```

The inversion is the part to not "simplify": `MonochromeRaster` stores a set bit
as **black** (matching ESC/POS), and TSPL treats a set bit as **white**. In
Swift that is `~byte` on `UInt8`, which is already unsigned — simpler than the
Kotlin's `byte.toInt().inv() and 0xFF` dance around signed bytes, and one of the
few places the Swift is genuinely cleaner.

Build into a `Data` with capacity reserved (`bytes.count + 64`), the same as the
Kotlin's `ByteArrayOutputStream` sizing hint.

### 7.2 `toEscPosRaster()`

```
1D 76 30 00                       GS v 0, m = 0 (normal density)
rowBytes & 0xFF, rowBytes >> 8    xL xH — width in BYTES
height  & 0xFF, height  >> 8      yL yH — height in DOTS
<raster bytes, unmodified>        a set bit is already black
```

Keep the precondition: height `> 0xFFFF` throws, with the same message naming
the fix ("scale the image down or split it into slices"). Note the asymmetry —
width is in bytes, height is in dots — because it is the classic mistake in this
command and the Kotlin comment flags it.

### 7.3 Status decoding

`Data+toEscPosStatus.swift`, `UInt8+toTsplStatus.swift` and
`UInt8+isValidEscPosStatusByte.swift` are direct ports with no platform content.
Three things to preserve exactly:

- **The `online` derivation must stay identical across both languages.** Both
  Kotlin files carry a comment saying so, and the reason is that an open cover
  must not report differently depending on which language the printer happens to
  be in.
- **The per-byte validity gate** (`0x93` mask, `0x12` pattern) with each flag
  defaulting to `false` when its source byte fails. "Corrupt" must read as "no
  information", not as "no fault".
- **The TSPL code table is a lookup, not a bitfield.** The Kotlin comment
  explains why at length; a Swift `switch` over the documented codes with a
  `faulted: true` default for anything unrecognised is the faithful port.

---

## 8. Risks and open questions

**Hardware/model dependency — the top risk.** Some XPrinter models, and most
cheap OEM boards, are Bluetooth Classic only. For those there is no iOS path
from this library, from XPrinter's own SDK, or from anyone. The library must
degrade honestly: `isSupported` reports BLE availability on the *phone*, and
per-printer reachability surfaces as a specific connect-time error (§4.2). Do
not let the README imply "iOS works now".

**Real hardware is required before shipping — no exceptions.** The Android
calibration numbers in `XPRINTER_P323B` were measured off printed paper, and
[printer-core.md §1](printer-core.md#1-what-the-hardware-established) is
explicit that five design decisions exist because a printer forced them. The
iOS transport adds new unknowns the simulator cannot answer at all: the
simulator has no Bluetooth (§5.2), so *every* transport phase is
hardware-gated. Budget for an XP-P323B and an iPhone on the same desk.

**BLE chunking correctness.** The highest-probability functional bug. A raster
that is truncated mid-transfer produces a label that prints *partially* — which
reads as a paper or heat problem, not a transport problem, and will cost hours
if the MTU is not logged. Mitigations: `.withResponse` writes only in Phase 1;
log the negotiated `maximumWriteValueLength` on every connect; make the first
hardware test a payload that is deliberately several MTUs long with recognisable
content at the end (a TSPL label with a frame around the full canvas fails
visibly and unambiguously when the tail is dropped).

**Throughput may make iOS printing feel bad even when it is correct** (§4.4).
Worth measuring in Phase 1 and reporting honestly rather than discovering in a
driver's van. If a 20-byte MTU turns out to be common on the target hardware,
that is a product-level finding that should reach the user before Phase 2 starts.

**The 700 ms reply timeout is an SPP measurement.** `LanguageProbePlan` and
`StatusQueryPlan` both use `REPLY_TIMEOUT_MS = 700`, justified as "a real-time
status command answers within a few milliseconds **over RFCOMM**". BLE adds a
connection-interval quantum (7.5–48 ms typical, and iOS chooses) to every round
trip, and a status query is write-then-notify, so it costs at least two
intervals. 700 ms is probably still generous, but it is an untested
transplant. **Measure the actual reply latency in Phase 2 and adjust the iOS
constant if needed** — do not silently share a constant whose justification does
not apply.

**`detectLanguage()` may behave differently on the BLE channel.** The probe's
correctness depends on an ESC/POS printer answering `DLE EOT 1` immediately and
a TSPL printer ignoring it. If the BLE firmware buffers differently from the SPP
firmware — plausible, they are different code paths in the module — the probe
could return inconclusive where SPP returned conclusive. `declareLanguage()`
exists precisely for this, but the iOS docs should be honest about reduced probe
reliability if that turns out to be the case.

**Notify-vs-poll inbox races** (§4.3). Unsolicited bytes arriving between
operations is a new failure mode with no Android equivalent. Clearing the inbox
on read entry handles the common case; a printer that notifies continuously
would need more. Watch for it in Phase 2.

**Peripheral identity across app reinstalls** (§2.1). A saved printer stops
resolving after a reinstall, and the failure looks like "the printer disappeared".
The reference `PrinterSession` in the example app will need an iOS path that
falls back to a scan and re-matches by name. Out of scope for the library, in
scope for the example app.

**`Info.plist` key cannot be injected by the pod** (§5.1). Every integrator who
misses it gets a crash on first scan. An Expo config plugin removes this for the
example app's audience; nothing removes it for bare RN apps except documentation.

**Open question for the user:** should iOS support be gated behind an opt-in
(a separate entry point, or a `Xprinter.isSupported` that stays `false` until
explicitly enabled) for the first release, so that a Classic-only printer does
not turn a working Android product into a support burden? Worth deciding before
Phase 1 ships rather than after.

---

## 9. Phased implementation plan

Each phase ends with something verified against real hardware, mirroring how the
Android side was built. A phase that cannot be demonstrated is not done.

### Phase 1 — Prove the transport (hardware-gated)

**Goal: bytes from an iPhone reach an XP-P323B and come out as ink.** Nothing
about Nitro, nothing about the public API.

1. A throwaway Swift harness (a plain SwiftUI app, or a test target) that:
   scans unfiltered, lists every peripheral with name/RSSI/advertised services,
   connects to a chosen one, dumps **every** service and characteristic UUID
   with its properties, and logs `maximumWriteValueLength` for both write types.
2. Write a hand-built TSPL job (`SIZE`/`CLS`/`BOX` around the full canvas/`PRINT 1,1`)
   split at the negotiated MTU with `.withResponse`, and print it.
3. Read back: enable notify, send `DLE EOT 1` (`10 04 01`) and `~!T`, log the
   replies.

**Exit criteria — all four:** the printer appears in a scan; its write and
notify characteristics are identified and **written down in this document**; a
multi-MTU TSPL label prints complete, with its border intact on all four sides;
at least one status query returns bytes. Record the measured per-KB transfer
time.

If the printer never appears in a scan, **stop here and report** — the rest of
this plan does not apply to that unit, and that is a finding worth having cheaply.

### Phase 2 — The Nitro transport surface

Replace the stubs with the real `XprinterBluetooth` + `BluetoothPrinter`:
`HybridXprinterBluetooth.swift`, `BluetoothCentral`, `BluetoothDiscoverySession.swift`,
`BluetoothPermissions.swift`, `BluetoothPreflight.swift`,
`PrinterPeripheralLink.swift`, `HybridBluetoothPrinter.swift`, plus
`ListenerRegistry.swift`, `PrinterDefaults.swift`, the two probe/query plans and
the four status-decoding extensions.

**Exit criteria:** the existing example app, unchanged, runs on an iPhone and
completes its whole flow — permissions, device list, connect,
`detectLanguage()`, an ESC/POS or TSPL test print, `readStatus()`, disconnect.
`readStatus()` correctly reports an open cover and an empty roll on real
hardware (open the lid, remove the paper — the same way the Android mapping was
checked). Measured reply latency recorded, and the 700 ms constants confirmed or
adjusted.

### Phase 3 — Rasterization (simulator-testable)

`HybridPrinterImageFactory.swift` (including the missing `countPages`),
`HybridPrinterRaster.swift`, `MonochromeRaster.swift`,
`MonochromeRasterizer.swift`, `PdfPageRenderer.swift`, `SourceFiles.swift`,
`SourceImageLoader.swift`, and the two encoder extensions.

This phase needs no printer, and its acceptance test should exploit that:
**rasterize a fixed corpus — a PNG with alpha, a photo, a one-page PDF, a
multi-page PDF, an HTML-to-PDF page with a small amount of content in one corner
(the `trimToContent` case) — on both platforms and compare the output bytes.**
They should be identical. Where they are not, the difference is a port bug, and
the byte offset points straight at which stage.

**Exit criteria:** byte-identical raster output across platforms for the corpus;
`countPages` agrees; `trimToContent` produces the same crop rect within a probe
pixel.

### Phase 4 — Wire up and document

The `print*` job functions are pure TypeScript over the two HybridObjects, so
they need no work — which is the point. This phase is verification and
documentation:

- `printImageAsLabel` / `printImageAsReceipt` / `printPdfAsLabel` /
  `printPdfAsReceipt` all run on iOS against real hardware, multi-page included.
- Confirm the `XPRINTER_P323B` calibration transfers unchanged. It describes the
  print head, not the transport, so it should — but "should" is why it gets
  checked on paper.
- README: replace the "Android only" banner with an accurate statement of what
  works, on which hardware, and what the BLE throughput difference means. Add the
  iOS installation section with `NSBluetoothAlwaysUsageDescription`.
- `driver-app-integration.md`: update "What is not built yet" and add the saved
  `address`-is-not-portable caveat from §2.1.
- `printer-core.md`: update §11 and strike the §12 "Bluetooth Classic stays out
  of reach" line, replacing it with what the transport boundary test actually
  showed (§3.2).
- Optionally: the Expo config plugin for the `Info.plist` key.

---

## Sources

- XPrinter download centre, listing **iOS SDK v2.3.0** — https://www.xprintertech.com/download.html
- XPrinter XP-P323B product page, **"Dual mode bluetooth"** — https://www.xprintertech.com/xp-p323b
- `POSBLEManager.h` (XPrinter iOS SDK, CoreBluetooth surface) — https://github.com/anhnt224/x_printer
- Verbatim copy of the official **iOS SDK v2.3.0 (SDK + demo)**, including the demo's `Info.plist` — https://github.com/virtualspirit/react-native-network-printer
- `BLEManager.m` — an open-source sibling of the same SDK family, showing the `18F0`/`FFF0` discovery filter, the characteristic-selection bug, and the chunking approach — https://github.com/eatme-global/react-native-pos-thermal-printer
- Another React Native binding around the same `libPrinterSDK.a` — https://github.com/anymore1405/react-native-xprinter-sdk
- Flutter binding around the same SDK — https://pub.dev/packages/x_printer
- KT6368A dual-mode module, documenting the ISSC UUID triple used by this class of printer — https://dev.to/ble_voice/solution-for-thermal-printers-using-the-kt6368a-dual-mode-bluetooth-chip-module-33hm
- `CBPeripheral.maximumWriteValueLength(for:)` — https://developer.apple.com/documentation/corebluetooth/cbperipheral/maximumwritevaluelength(for:)
- `NSBluetoothAlwaysUsageDescription` — https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription

Third-party repositories above are cited as **evidence of what the vendor SDK
does**, not as code to copy. Two of them contain bugs this spec deliberately
designs around (§4.2, §4.4).
