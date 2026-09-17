package com.margelo.nitro.xprinter

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The runtime permissions this library needs, and the prompt that asks for them.
 */
internal object BluetoothPermissions {
  /**
   * An arbitrary but stable request code. React Native routes the result back to
   * the [PermissionListener] registered under it.
   */
  private const val REQUEST_CODE = 0x5850

  /**
   * The permissions required to discover and connect to a Bluetooth Classic
   * printer on this OS version.
   *
   * Android 12 (API 31) replaced the location-permission requirement with the
   * dedicated `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` pair. Below that, classic
   * discovery returns no results without location access.
   */
  val required: Array<String>
    get() =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
      } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
      }

  /**
   * The current state, without prompting.
   *
   * Never returns [BluetoothPermissionStatus.BLOCKED]: telling a re-askable
   * denial apart from a permanent one needs an `Activity`, and before the first
   * prompt the two are indistinguishable anyway.
   */
  fun status(context: Context): BluetoothPermissionStatus =
    if (missing(context).isEmpty()) {
      BluetoothPermissionStatus.GRANTED
    } else {
      BluetoothPermissionStatus.DENIED
    }

  /**
   * Prompts for every missing permission and suspends until the user answers.
   *
   * Must be called on the main thread — Android only accepts a permission
   * request from a foreground `Activity`.
   *
   * @throws IllegalStateException if no React `Activity` is currently attached,
   * which is the case while the app is in the background.
   */
  suspend fun request(context: ReactApplicationContext): BluetoothPermissionStatus {
    val missing = missing(context)
    if (missing.isEmpty()) {
      return BluetoothPermissionStatus.GRANTED
    }

    val activity = context.currentActivity
      ?: throw IllegalStateException(
        "Cannot ask for Bluetooth permissions: no Activity is attached. " +
          "Call requestPermissions() while the app is in the foreground."
      )
    val permissionAwareActivity = activity as? PermissionAwareActivity
      ?: throw IllegalStateException(
        "Cannot ask for Bluetooth permissions: ${activity::class.java.name} does not " +
          "implement PermissionAwareActivity. Make your Activity extend ReactActivity."
      )

    return suspendCancellableCoroutine { continuation ->
      val listener = PermissionListener { _, permissions, grantResults ->
        if (continuation.isActive) {
          continuation.resume(statusOf(activity, permissions, grantResults))
        }
        // `true` removes this one-shot listener from React Native's registry.
        true
      }
      permissionAwareActivity.requestPermissions(missing, REQUEST_CODE, listener)
    }
  }

  private fun missing(context: Context): Array<String> =
    required
      .filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
      .toTypedArray()

  /**
   * A denial is [BluetoothPermissionStatus.BLOCKED] rather than
   * [BluetoothPermissionStatus.DENIED] once Android stops offering a rationale,
   * which is how "Don't ask again" surfaces to an app.
   */
  private fun statusOf(
    activity: android.app.Activity,
    permissions: Array<out String>,
    grantResults: IntArray,
  ): BluetoothPermissionStatus {
    val deniedPermissions = permissions.filterIndexed { index, _ ->
      grantResults.getOrNull(index) != PackageManager.PERMISSION_GRANTED
    }
    return when {
      deniedPermissions.isEmpty() -> BluetoothPermissionStatus.GRANTED
      deniedPermissions.any { activity.shouldShowRequestPermissionRationale(it) } ->
        BluetoothPermissionStatus.DENIED
      else -> BluetoothPermissionStatus.BLOCKED
    }
  }
}
