package com.margelo.nitro.xprinter

import android.bluetooth.BluetoothSocket
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
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

  override fun disconnect(): Promise<Unit> = Promise.parallel { close() }

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
  }
}
