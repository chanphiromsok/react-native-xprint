package com.margelo.nitro.xprinter

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import androidx.annotation.RequiresPermission
import com.margelo.nitro.xprinter.extension.bluetoothDeviceExtra
import com.margelo.nitro.xprinter.extension.toDeviceInfo

/**
 * Owns the Bluetooth Classic discovery scan and the listeners watching it.
 *
 * Android reports discovery through sticky-free system broadcasts, so a
 * [BroadcastReceiver] is the only way to observe it. The receiver is registered
 * once on the first scan and stays registered until [dispose], which keeps
 * registration on a single owner (the main thread) and avoids racing the
 * `DISCOVERY_FINISHED` broadcast that a restart produces.
 *
 * [start] and [stop] must be called on the main thread.
 */
internal class BluetoothDiscoverySession(private val context: Context) {
  private val deviceListeners = ListenerRegistry<(BluetoothDeviceInfo) -> Unit>()
  private val stateListeners = ListenerRegistry<(Boolean) -> Unit>()

  /** Read from the JS thread, written from the main thread. */
  @Volatile
  var isDiscovering: Boolean = false
    private set

  private var isReceiverRegistered = false

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        BluetoothDevice.ACTION_FOUND -> emitDeviceFound(intent)
        BluetoothAdapter.ACTION_DISCOVERY_STARTED -> setDiscovering(true)
        BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> setDiscovering(false)
      }
    }
  }

  fun addDeviceListener(listener: (BluetoothDeviceInfo) -> Unit): ListenerSubscription =
    ListenerSubscription(deviceListeners.add(listener))

  fun addStateListener(listener: (Boolean) -> Unit): ListenerSubscription =
    ListenerSubscription(stateListeners.add(listener))

  /**
   * Starts a scan, restarting one that is already running.
   *
   * @throws IllegalStateException if the adapter refused to start discovering.
   */
  @RequiresPermission(Manifest.permission.BLUETOOTH_SCAN)
  fun start(adapter: BluetoothAdapter) {
    try {
      registerReceiver()

      if (adapter.isDiscovering) {
        adapter.cancelDiscovery()
      }

      check(adapter.startDiscovery()) {
        "Bluetooth refused to start discovery. This usually means the adapter is busy or turned off."
      }
    } catch (e: SecurityException) {
      throw IllegalStateException(
        "Bluetooth scan permission is not granted.",
        e
      )
    }
  }

  /** Stops a running scan. Does nothing when no scan is running. */
  @RequiresPermission(Manifest.permission.BLUETOOTH_SCAN)
  fun stop(adapter: BluetoothAdapter) {
    if (adapter.isDiscovering) {
      adapter.cancelDiscovery()
    }
  }

  /** Unregisters the receiver and drops every listener. */
  fun dispose() {
    if (isReceiverRegistered) {
      context.unregisterReceiver(receiver)
      isReceiverRegistered = false
    }
    deviceListeners.clear()
    stateListeners.clear()
    isDiscovering = false
  }

  private fun emitDeviceFound(intent: Intent) {
    val device = intent.bluetoothDeviceExtra() ?: return
    val rawRssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, UNKNOWN_RSSI)
    val info = device.toDeviceInfo(
      rssi = if (rawRssi == UNKNOWN_RSSI) null else rawRssi.toDouble()
    )
    deviceListeners.forEach { it(info) }
  }

  private fun setDiscovering(discovering: Boolean) {
    if (isDiscovering == discovering) {
      return
    }
    isDiscovering = discovering
    stateListeners.forEach { it(discovering) }
  }

  private fun registerReceiver() {
    if (isReceiverRegistered) {
      return
    }
    val filter = IntentFilter().apply {
      addAction(BluetoothDevice.ACTION_FOUND)
      addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED)
      addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
    isReceiverRegistered = true
  }

  private companion object {
    /** The sentinel Android uses when a broadcast carries no signal strength. */
    const val UNKNOWN_RSSI: Short = Short.MIN_VALUE
  }
}
