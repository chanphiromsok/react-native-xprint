package com.margelo.nitro.xprinter.extension

import android.bluetooth.BluetoothClass
import com.margelo.nitro.xprinter.BluetoothMajorDeviceClass

/**
 * Maps an Android [BluetoothClass.Device.Major] constant onto the JS-facing
 * [com.margelo.nitro.xprinter.BluetoothMajorDeviceClass]. Unknown values fall back to
 * [com.margelo.nitro.xprinter.BluetoothMajorDeviceClass.UNCATEGORIZED].
 */
internal fun BluetoothMajorDeviceClass.Companion.fromAndroidMajorDeviceClass(
  majorDeviceClass: Int
): BluetoothMajorDeviceClass =
  when (majorDeviceClass) {
    BluetoothClass.Device.Major.MISC -> BluetoothMajorDeviceClass.MISC
    BluetoothClass.Device.Major.COMPUTER -> BluetoothMajorDeviceClass.COMPUTER
    BluetoothClass.Device.Major.PHONE -> BluetoothMajorDeviceClass.PHONE
    BluetoothClass.Device.Major.NETWORKING -> BluetoothMajorDeviceClass.NETWORKING
    BluetoothClass.Device.Major.AUDIO_VIDEO -> BluetoothMajorDeviceClass.AUDIOVIDEO
    BluetoothClass.Device.Major.PERIPHERAL -> BluetoothMajorDeviceClass.PERIPHERAL
    BluetoothClass.Device.Major.IMAGING -> BluetoothMajorDeviceClass.IMAGING
    BluetoothClass.Device.Major.WEARABLE -> BluetoothMajorDeviceClass.WEARABLE
    BluetoothClass.Device.Major.TOY -> BluetoothMajorDeviceClass.TOY
    BluetoothClass.Device.Major.HEALTH -> BluetoothMajorDeviceClass.HEALTH
    else -> BluetoothMajorDeviceClass.UNCATEGORIZED
  }
