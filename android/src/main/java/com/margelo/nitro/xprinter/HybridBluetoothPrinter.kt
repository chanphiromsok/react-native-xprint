package com.margelo.nitro.xprinter

import android.bluetooth.BluetoothSocket
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * An open RFCOMM connection to a printer.
 *
 * The socket is owned by one dedicated thread: every [write] runs there, in call
 * order, so two writes can never interleave on the wire. [disconnect] and
 * [dispose] deliberately close the socket from the calling thread instead, which
 * is how a `BluetoothSocket` blocked in a write is unblocked.
 */
@DoNotStrip
internal class HybridBluetoothPrinter(
  private val socket: BluetoothSocket,
  override val device: BluetoothDeviceInfo,
) : HybridBluetoothPrinterSpec() {
  private val writeExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "XprinterConnection-${device.address}")
  }
  private val writeScope = CoroutineScope(SupervisorJob() + writeExecutor.asCoroutineDispatcher())
  private val isClosed = AtomicBoolean(false)

  override val isConnected: Boolean
    get() = !isClosed.get() && socket.isConnected

  /**
   * Settable device state. Written from the JS thread and read from the
   * connection thread, so every field is volatile and each is replaced whole
   * rather than mutated in place.
   */
  @Volatile
  override var calibration: PrinterCalibration = PrinterDefaults.calibration()

  @Volatile
  override var media: LabelMedia? = null

  @Volatile
  private var knownLanguage: CommandLanguage? = null

  override val language: CommandLanguage?
    get() = knownLanguage

  override fun declareLanguage(language: CommandLanguage) {
    knownLanguage = language
  }

  /**
   * An RFCOMM socket holds kernel-side send and receive buffers that the JS heap
   * cannot see. Reporting them lets the JS GC collect a dropped connection under
   * memory pressure instead of holding the socket open indefinitely.
   */
  override val memorySize: Long
    get() = SOCKET_MEMORY_SIZE

  override fun write(data: ArrayBuffer): Promise<Unit> {
    // Copy on the JS thread: an ArrayBuffer from JS is non-owning, and the
    // memory behind it stops being valid the moment this call returns.
    val bytes = data.toByteArray()

    return Promise.async(writeScope) {
      if (isClosed.get()) {
        throw IOException("Cannot write to ${device.address}: the connection is closed.")
      }
      try {
        writeInChunks(bytes)
      } catch (error: IOException) {
        close()
        throw IOException(
          "Failed to write ${bytes.size} bytes to ${device.address}. The printer " +
            "may have been powered off or moved out of range.",
          error
        )
      }
    }
  }

  override fun read(maxBytes: Double, timeoutMs: Double): Promise<ArrayBuffer> =
    Promise.async(writeScope) {
      ArrayBuffer.copy(readWithin(maxBytes.toInt(), timeoutMs.toLong()))
    }

  override fun detectLanguage(): Promise<LanguageProbe> =
    Promise.async(writeScope) {
      // ESC/POS first: its status command is real-time and prints nothing on
      // either language, so a printer that answers it costs no paper.
      writeInChunks(LanguageProbePlan.ESC_POS_STATUS)
      val escPosReply = readWithin(
        LanguageProbePlan.ESC_POS_REPLY_BYTES,
        LanguageProbePlan.REPLY_TIMEOUT_MS
      )

      // Only ask TSPL when ESC/POS stayed silent — an ESC/POS printer would
      // print `~!T` as text rather than answer it.
      val tsplReply = if (escPosReply.isEmpty()) {
        writeInChunks(LanguageProbePlan.TSPL_MODEL_QUERY)
        readWithin(
          LanguageProbePlan.TSPL_REPLY_BYTES,
          LanguageProbePlan.REPLY_TIMEOUT_MS
        )
      } else {
        ByteArray(0)
      }

      val escPosReplied = escPosReply.isNotEmpty()
      val tsplReplied = tsplReply.isNotEmpty()
      val likely = when {
        escPosReplied && !tsplReplied -> CommandLanguage.ESCPOS
        tsplReplied && !escPosReplied -> CommandLanguage.TSPL
        // Both or neither: no honest conclusion to draw.
        else -> null
      }
      // Remember a conclusive result so the probe is paid for once per
      // connection. An inconclusive one leaves any declared language alone.
      if (likely != null) {
        knownLanguage = likely
      }

      LanguageProbe(
        likely = likely,
        escPosReplied = escPosReplied,
        tsplReplied = tsplReplied,
        model = tsplReply.toPrintableAscii().takeIf { it.isNotEmpty() },
        escPosReply = ArrayBuffer.copy(escPosReply),
        tsplReply = ArrayBuffer.copy(tsplReply)
      )
    }

  override fun disconnect(): Promise<Unit> = Promise.parallel { close() }

  override fun readStatus(): Promise<PrinterStatus> =
    Promise.async(writeScope) {
      // `knownLanguage` may already be set from a prior `declareLanguage` or a
      // conclusive `detectLanguage`. Only pay for a fresh probe when it is not.
      val language = knownLanguage ?: run {
        detectLanguage().await()
        knownLanguage
      } ?: throw IOException(
        "This printer did not answer a status query, so its command language " +
          "is unknown."
      )

      when (language) {
        CommandLanguage.ESCPOS -> readEscPosStatus()
        CommandLanguage.TSPL -> readTsplStatus()
      }
    }

  override fun dispose() {
    close()
    super.dispose()
  }

  /**
   * Writes in RFCOMM-sized pieces rather than handing the whole job to the
   * socket at once.
   *
   * A single large write blocks until the printer has drained every byte, and a
   * thermal printer drains only as fast as it prints. A 45 KB label image sent
   * as one write can stall for a long time or wedge outright; the same bytes
   * sent a frame at a time flow steadily, because each write returns as soon as
   * that piece is accepted.
   */
  private fun writeInChunks(bytes: ByteArray) {
    val stream = socket.outputStream
    var offset = 0
    while (offset < bytes.size) {
      if (isClosed.get()) {
        throw IOException("The connection to ${device.address} was closed mid-write.")
      }
      val length = minOf(CHUNK_SIZE, bytes.size - offset)
      stream.write(bytes, offset, length)
      stream.flush()
      offset += length
    }
  }

  /**
   * Reads until [maxBytes] have arrived or [timeoutMs] has elapsed, returning
   * whatever was received.
   *
   * A `BluetoothSocket`'s input stream has no read timeout and blocks
   * indefinitely, so the only way to bound the wait is to poll [available] and
   * read only what is already there. The poll interval is deliberately short:
   * a real-time status command answers within a few milliseconds.
   */
  private fun readWithin(maxBytes: Int, timeoutMs: Long): ByteArray {
    val stream = socket.inputStream
    val received = ByteArrayOutputStream()
    val deadline = System.currentTimeMillis() + timeoutMs

    while (received.size() < maxBytes && System.currentTimeMillis() < deadline) {
      if (isClosed.get()) {
        throw IOException("The connection to ${device.address} was closed mid-read.")
      }
      val available = stream.available()
      if (available <= 0) {
        Thread.sleep(READ_POLL_MS)
        continue
      }
      val chunk = ByteArray(minOf(available, maxBytes - received.size()))
      val count = stream.read(chunk)
      if (count < 0) {
        break // peer closed the stream
      }
      received.write(chunk, 0, count)
    }
    return received.toByteArray()
  }

  /**
   * Runs the three ESC/POS real-time status queries in sequence — offline,
   * error, then paper sensor — and maps the replies to a [PrinterStatus].
   *
   * Three round trips rather than one: ESC/POS's `DLE EOT n` answers about a
   * single subsystem per `n`, so a full picture means asking for each of them.
   * Each query is validated on its own via [requireStatusReply] before the
   * next is sent, so a printer that stops answering partway through fails
   * with a clear reason instead of a converter silently working from a
   * shorter array than it expected.
   */
  private suspend fun readEscPosStatus(): PrinterStatus {
    writeInChunks(StatusQueryPlan.ESC_POS_OFFLINE_STATUS)
    val offlineReply = readWithin(StatusQueryPlan.ESC_POS_REPLY_BYTES, StatusQueryPlan.REPLY_TIMEOUT_MS)
    requireStatusReply(offlineReply)

    writeInChunks(StatusQueryPlan.ESC_POS_ERROR_STATUS)
    val errorReply = readWithin(StatusQueryPlan.ESC_POS_REPLY_BYTES, StatusQueryPlan.REPLY_TIMEOUT_MS)
    requireStatusReply(errorReply)

    writeInChunks(StatusQueryPlan.ESC_POS_PAPER_STATUS)
    val paperReply = readWithin(StatusQueryPlan.ESC_POS_REPLY_BYTES, StatusQueryPlan.REPLY_TIMEOUT_MS)
    requireStatusReply(paperReply)

    return (offlineReply + errorReply + paperReply).toEscPosStatus()
  }

  /**
   * Runs the single TSPL `<ESC>!?` status query and maps the reply to a
   * [PrinterStatus].
   */
  private suspend fun readTsplStatus(): PrinterStatus {
    writeInChunks(StatusQueryPlan.TSPL_STATUS_QUERY)
    val reply = readWithin(StatusQueryPlan.TSPL_REPLY_BYTES, StatusQueryPlan.REPLY_TIMEOUT_MS)
    requireStatusReply(reply)

    return reply[0].toTsplStatus()
  }

  /**
   * Fails fast when a status query goes unanswered, rather than letting a
   * converter read past the end of a shorter-than-expected array.
   *
   * Many low-cost thermal printers implement no status command at all, so
   * this is not necessarily a sign the connection itself is broken.
   */
  private fun requireStatusReply(reply: ByteArray) {
    if (reply.isEmpty()) {
      throw IOException(
        "The printer did not answer a status query. Many low-cost thermal " +
          "printers implement no status command at all."
      )
    }
  }

  /** Closes the socket and releases the write thread. Safe to call repeatedly. */
  private fun close() {
    if (!isClosed.compareAndSet(false, true)) {
      return
    }
    runCatching { socket.close() }
    writeScope.cancel()
    writeExecutor.shutdown()
  }

  private companion object {
    /** A rough estimate of the socket's off-heap buffers, in bytes. */
    const val SOCKET_MEMORY_SIZE = 64L * 1024L

    /**
     * Kept under the 1008-byte RFCOMM frame payload so no chunk is fragmented
     * across two frames.
     */
    const val CHUNK_SIZE = 512

    /** How often to check for bytes while waiting on a reply. */
    const val READ_POLL_MS = 10L
  }
}
