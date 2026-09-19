package com.margelo.nitro.xprinter

import android.Manifest
import android.bluetooth.BluetoothAdapter
import androidx.annotation.RequiresPermission
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.ReactApplicationContext
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.margelo.nitro.xprinter.extension.openSppSocket
import com.margelo.nitro.xprinter.extension.toDeviceInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * The Android implementation of [XprinterBluetooth]: discovers Bluetooth Classic
 * printers and opens SPP connections to them.
 *
 * Two owners, each required by the platform:
 * - [mainScope] owns the discovery broadcast receiver and the permission dialog,
 *   both of which Android only accepts from the main thread.
 * - [ioScope] owns the blocking adapter and socket calls.
 */
@DoNotStrip
class HybridXprinterBluetooth : HybridXprinterBluetoothSpec() {
  private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  private val reactContext: ReactApplicationContext
    get() = NitroModules.applicationContext
      ?: throw IllegalStateException(
        "No ReactApplicationContext is available yet. Use Xprinter after React " +
          "Native has finished initializing."
      )

  private val discovery: BluetoothDiscoverySession by lazy {
    BluetoothDiscoverySession(reactContext.applicationContext)
  }

  override val isSupported: Boolean
    get() = BluetoothPreflight.adapterOrNull(reactContext) != null

  override val isEnabled: Boolean
    get() = BluetoothPreflight.adapterOrNull(reactContext)?.isEnabled == true

  override val isDiscovering: Boolean
    get() = discovery.isDiscovering

  override val permissionStatus: BluetoothPermissionStatus
    get() = BluetoothPermissions.status(reactContext)

  override fun requestPermissions(): Promise<BluetoothPermissionStatus> =
    Promise.async(mainScope) { BluetoothPermissions.request(reactContext) }

  @RequiresPermission(Manifest.permission.BLUETOOTH_CONNECT)
  override fun getBondedDevices(): Promise<Array<BluetoothDeviceInfo>> =
    Promise.async(ioScope) {
      try {
        BluetoothPreflight.requireReadyAdapter(reactContext)
          .bondedDevices
          .map { it.toDeviceInfo(rssi = null) }
          .toTypedArray()
      } catch (e: SecurityException) {
        throw SecurityException(
          "Unable to read bonded Bluetooth devices; BLUETOOTH_CONNECT permission is missing or was revoked.",
          e
        )
      }
    }

  @RequiresPermission(Manifest.permission.BLUETOOTH_SCAN)
  override fun startDiscovery(): Promise<Unit> =
    Promise.async(mainScope) {
      discovery.start(BluetoothPreflight.requireReadyAdapter(reactContext))
    }

  @RequiresPermission(Manifest.permission.BLUETOOTH_SCAN)
  override fun stopDiscovery(): Promise<Unit> =
    Promise.async(mainScope) {
      BluetoothPreflight.adapterOrNull(reactContext)?.let { discovery.stop(it) }
    }

  override fun addDeviceFoundListener(
    listener: (device: BluetoothDeviceInfo) -> Unit
  ): ListenerSubscription = discovery.addDeviceListener(listener)

  override fun addDiscoveryStateListener(
    listener: (isDiscovering: Boolean) -> Unit
  ): ListenerSubscription = discovery.addStateListener(listener)

  @RequiresPermission(Manifest.permission.BLUETOOTH_SCAN)
  override fun connect(address: String): Promise<HybridBluetoothPrinterSpec> =
    Promise.async(ioScope) {
      val adapter = BluetoothPreflight.requireReadyAdapter(reactContext)
      require(BluetoothAdapter.checkBluetoothAddress(address)) {
        "'$address' is not a valid Bluetooth MAC address."
      }
      // A running scan saturates the radio and makes connecting fail or crawl.
      discovery.stop(adapter)

      val device = adapter.getRemoteDevice(address)
      val socket = device.openSppSocket()
      HybridBluetoothPrinter(socket, device.toDeviceInfo(rssi = null))
    }

  override fun dispose() {
    discovery.dispose()
    super.dispose()
  }
}
