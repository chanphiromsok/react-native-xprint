package com.margelo.nitro.xprinter.extension

import android.bluetooth.BluetoothDevice
import com.margelo.nitro.xprinter.BluetoothDeviceInfo
import com.margelo.nitro.xprinter.BluetoothMajorDeviceClass

/**
 * Snapshots this device into the JS-facing [com.margelo.nitro.xprinter.BluetoothDeviceInfo].
 *
 * Name, bond state and device class all require `BLUETOOTH_CONNECT` on
 * Android 12+. Reading them is best-effort: when the permission is missing the
 * device is still reported, just without those details, so a caller that only
 * has `BLUETOOTH_SCAN` still sees the addresses it discovered.
 *
 * @param rssi the signal strength from the discovery broadcast, or `null` for a
 * device that was not obtained through a scan.
 */
internal fun BluetoothDevice.toDeviceInfo(rssi: Double?): BluetoothDeviceInfo =
  BluetoothDeviceInfo(
    address = address,
    name = runCatching { name }.getOrNull()?.takeIf { it.isNotBlank() },
    isBonded = runCatching { bondState == BluetoothDevice.BOND_BONDED }.getOrDefault(false),
    rssi = rssi,
    majorDeviceClass = BluetoothMajorDeviceClass.Companion.fromAndroidMajorDeviceClass(
      runCatching { bluetoothClass?.majorDeviceClass }.getOrNull() ?: -1
    )
  )
