package com.margelo.nitro.xprinter.extension

import android.bluetooth.BluetoothDevice
import android.content.Intent
import android.os.Build

/**
 * Reads [BluetoothDevice.EXTRA_DEVICE] out of a Bluetooth broadcast, using the
 * type-safe parcelable API on Android 13+ and the deprecated one below that.
 */
internal fun Intent.bluetoothDeviceExtra(): BluetoothDevice? =
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
  } else {
    @Suppress("DEPRECATION")
    getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
  }
