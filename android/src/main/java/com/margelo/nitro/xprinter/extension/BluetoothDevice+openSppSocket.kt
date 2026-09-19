package com.margelo.nitro.xprinter.extension

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import java.io.IOException
import java.util.UUID

/** The well-known Serial Port Profile service record every SPP printer exposes. */
private val SPP_SERVICE_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

/**
 * Opens and connects an RFCOMM socket to this device's serial port service.
 *
 * Blocks until the socket is connected, so this must not run on the main thread.
 *
 * A secure socket is tried first. Many low-cost thermal printers — XPrinter
 * models among them — ship without a PIN and refuse the authenticated channel,
 * so an insecure socket is tried next. If both fail, the secure error is thrown
 * with the insecure one attached as a suppressed exception.
 *
 * @throws IOException if the printer could not be reached.
 */
internal fun BluetoothDevice.openSppSocket(): BluetoothSocket {
  val secureFailure = try {
    return connectSocket(createRfcommSocketToServiceRecord(SPP_SERVICE_UUID))
  } catch (error: IOException) {
    error
  }

  try {
    return connectSocket(createInsecureRfcommSocketToServiceRecord(SPP_SERVICE_UUID))
  } catch (insecureFailure: IOException) {
    secureFailure.addSuppressed(insecureFailure)
  }

  throw IOException(
    "Could not open a serial port connection to $address. Check that the printer " +
      "is powered on, in range, and not already connected to another device.",
    secureFailure
  )
}

private fun connectSocket(socket: BluetoothSocket): BluetoothSocket {
  try {
    socket.connect()
  } catch (error: IOException) {
    runCatching { socket.close() }
    throw error
  }
  return socket
}
