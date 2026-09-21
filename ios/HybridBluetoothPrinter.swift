import CoreBluetooth
import Foundation
import NitroModules

/// The iOS implementation of `BluetoothPrinter`: an open Bluetooth LE
/// connection to a printer, backed by a `PrinterPeripheralLink`.
///
/// This orchestration layer is a near-line-for-line port of
/// `HybridBluetoothPrinter.kt` — `detectLanguage`, `readStatus`, and the
/// status-decoding calls are unchanged from Android. Only the byte-delivery
/// calls (`write`/`read`) differ, because they go through
/// `PrinterPeripheralLink` instead of a raw socket stream.
final class HybridBluetoothPrinter: HybridBluetoothPrinterSpec {
  let device: BluetoothDeviceInfo
  private let link: PrinterPeripheralLink
  private let queue = DispatchQueue(label: "com.margelo.nitro.xprinter.bluetooth-printer")

  init(link: PrinterPeripheralLink, device: BluetoothDeviceInfo) {
    self.link = link
    self.device = device
    super.init()
  }

  var isConnected: Bool { link.isConnected }

  /// Settable device state, matching the Kotlin's `@Volatile var`s: written
  /// from the JS thread, read from the connection queue.
  var calibration: PrinterCalibration = PrinterDefaults.calibration()
  var media: LabelMedia?

  private var knownLanguage: CommandLanguage?
  var language: CommandLanguage? { knownLanguage }

  func declareLanguage(language: CommandLanguage) throws {
    knownLanguage = language
  }

  func write(data: ArrayBuffer) throws -> Promise<Void> {
    // Copy on the JS thread: an ArrayBuffer from JS is non-owning, and the
    // memory behind it stops being valid the moment this call returns.
    let bytes = data.toData(copyIfNeeded: true)
    return Promise.async {
      try await self.link.write(bytes)
    }
  }

  func read(maxBytes: Double, timeoutMs: Double) throws -> Promise<ArrayBuffer> {
    Promise.async {
      let data = await self.link.read(maxBytes: Int(maxBytes), timeoutMs: Int(timeoutMs))
      return try Self.arrayBuffer(from: data)
    }
  }

  func detectLanguage() throws -> Promise<LanguageProbe> {
    Promise.async {
      // ESC/POS first: its status command is real-time and prints nothing
      // on either language, so a printer that answers it costs no paper.
      try await self.link.write(Data(LanguageProbePlan.escPosStatus))
      let escPosReply = await self.link.read(
        maxBytes: LanguageProbePlan.escPosReplyBytes,
        timeoutMs: Int(LanguageProbePlan.replyTimeoutMs)
      )

      // Only ask TSPL when ESC/POS stayed silent — an ESC/POS printer would
      // print `~!T` as text rather than answer it.
      let tsplReply: Data
      if escPosReply.isEmpty {
        try await self.link.write(Data(LanguageProbePlan.tsplModelQuery))
        tsplReply = await self.link.read(
          maxBytes: LanguageProbePlan.tsplReplyBytes,
          timeoutMs: Int(LanguageProbePlan.replyTimeoutMs)
        )
      } else {
        tsplReply = Data()
      }

      let escPosReplied = !escPosReply.isEmpty
      let tsplReplied = !tsplReply.isEmpty
      let likely: CommandLanguage? =
        if escPosReplied, !tsplReplied {
          .escpos
        } else if tsplReplied, !escPosReplied {
          .tspl
        } else {
          // Both or neither: no honest conclusion to draw.
          nil
        }
      // Remember a conclusive result so the probe is paid for once per
      // connection. An inconclusive one leaves any declared language alone.
      if let likely {
        self.knownLanguage = likely
      }

      let model = tsplReply.toPrintableAscii()
      return LanguageProbe(
        likely: likely,
        escPosReplied: escPosReplied,
        tsplReplied: tsplReplied,
        model: model.isEmpty ? nil : model,
        escPosReply: try Self.arrayBuffer(from: escPosReply),
        tsplReply: try Self.arrayBuffer(from: tsplReply)
      )
    }
  }

  func disconnect() throws -> Promise<Void> {
    Promise.parallel {
      self.link.close()
      // `close()` only tears down this link's own pending continuations;
      // the physical connection itself is owned by `BluetoothCentral` and
      // must be told separately to actually drop it.
      BluetoothCentral.shared.forgetLink(identifier: self.link.peripheral.identifier)
    }
  }

  func readStatus() throws -> Promise<PrinterStatus> {
    Promise.async {
      // `knownLanguage` may already be set from a prior `declareLanguage` or
      // a conclusive `detectLanguage`. Only pay for a fresh probe when it is
      // not.
      let language: CommandLanguage
      if let knownLanguage = self.knownLanguage {
        language = knownLanguage
      } else {
        _ = try await self.detectLanguage().await()
        guard let resolved = self.knownLanguage else {
          throw RuntimeError.error(
            withMessage: "This printer did not answer a status query, so its command language is unknown."
          )
        }
        language = resolved
      }

      switch language {
      case .escpos:
        return try await self.readEscPosStatus()
      case .tspl:
        return try await self.readTsplStatus()
      @unknown default:
        throw RuntimeError.error(withMessage: "Unknown command language.")
      }
    }
  }

  /// Runs the three ESC/POS real-time status queries in sequence — offline,
  /// error, then paper sensor — and maps the replies to a `PrinterStatus`.
  private func readEscPosStatus() async throws -> PrinterStatus {
    try await link.write(Data(StatusQueryPlan.escPosOfflineStatus))
    let offlineReply = await link.read(
      maxBytes: StatusQueryPlan.escPosReplyBytes, timeoutMs: Int(StatusQueryPlan.replyTimeoutMs)
    )
    try Self.requireStatusReply(offlineReply)

    try await link.write(Data(StatusQueryPlan.escPosErrorStatus))
    let errorReply = await link.read(
      maxBytes: StatusQueryPlan.escPosReplyBytes, timeoutMs: Int(StatusQueryPlan.replyTimeoutMs)
    )
    try Self.requireStatusReply(errorReply)

    try await link.write(Data(StatusQueryPlan.escPosPaperStatus))
    let paperReply = await link.read(
      maxBytes: StatusQueryPlan.escPosReplyBytes, timeoutMs: Int(StatusQueryPlan.replyTimeoutMs)
    )
    try Self.requireStatusReply(paperReply)

    return try (offlineReply + errorReply + paperReply).toEscPosStatus()
  }

  /// Runs the single TSPL `<ESC>!?` status query and maps the reply to a
  /// `PrinterStatus`.
  private func readTsplStatus() async throws -> PrinterStatus {
    try await link.write(Data(StatusQueryPlan.tsplStatusQuery))
    let reply = await link.read(maxBytes: StatusQueryPlan.tsplReplyBytes, timeoutMs: Int(StatusQueryPlan.replyTimeoutMs))
    try Self.requireStatusReply(reply)
    return reply[reply.startIndex].toTsplStatus()
  }

  /// Fails fast when a status query goes unanswered, rather than letting a
  /// converter read past the end of a shorter-than-expected buffer. Many
  /// low-cost thermal printers implement no status command at all, so this
  /// is not necessarily a sign the connection itself is broken.
  private static func requireStatusReply(_ reply: Data) throws {
    if reply.isEmpty {
      throw RuntimeError.error(
        withMessage: "The printer did not answer a status query. Many low-cost thermal printers "
          + "implement no status command at all."
      )
    }
  }

  private static func arrayBuffer(from data: Data) throws -> ArrayBuffer {
    if data.isEmpty {
      return ArrayBuffer.allocate(size: 0)
    }
    return try ArrayBuffer.copy(data: data)
  }
}
