package com.margelo.nitro.xprinter

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context

/**
 * The checks that must pass before any Bluetooth Classic call is worth making.
 *
 * Keeping them here lets the HybridObjects read as a single guard instead of
 * repeating adapter, power-state and permission handling in every method.
 */
internal object BluetoothPreflight {
  /** The device's Bluetooth adapter, or `null` on hardware without Bluetooth. */
  fun adapterOrNull(context: Context): BluetoothAdapter? =
    context.getSystemService(BluetoothManager::class.java)?.adapter

  /**
   * The adapter, once it is usable.
   *
   * @throws UnsupportedOperationException if the device has no Bluetooth adapter.
   * @throws IllegalStateException if Bluetooth is turned off.
   * @throws SecurityException if a required permission has not been granted.
   */
  fun requireReadyAdapter(context: Context): BluetoothAdapter {
    val adapter = adapterOrNull(context)
      ?: throw UnsupportedOperationException("This device has no Bluetooth adapter.")

    val missingPermissions = BluetoothPermissions.required.filterNot { permission ->
      context.checkSelfPermission(permission) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }
    if (missingPermissions.isNotEmpty()) {
      throw SecurityException(
        "Missing Bluetooth permission(s): ${missingPermissions.joinToString()}. " +
          "Call Xprinter.requestPermissions() first."
      )
    }

    if (!adapter.isEnabled) {
      throw IllegalStateException(
        "Bluetooth is turned off. Ask the user to enable it before scanning or connecting."
      )
    }

    return adapter
  }
}
