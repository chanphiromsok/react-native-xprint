import type { HybridObject } from 'react-native-nitro-modules';
import type { BluetoothDeviceInfo } from '../types/BluetoothDeviceInfo';

/**
 * An open Bluetooth Classic (SPP) connection to a printer.
 *
 * Created by {@linkcode XprinterBluetooth.connect}, which only resolves once the
 * socket is actually open — so a `BluetoothPrinter` you hold is connected unless
 * it has since been disconnected or the socket dropped.
 */
export interface BluetoothPrinter extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  /** The device this connection was opened to. */
  readonly device: BluetoothDeviceInfo;
  /**
   * Whether the socket is still open.
   *
   * Turns `false` after `disconnect()`, or after a `write()` failed because the
   * printer went away (out of range, powered off, socket closed by the peer).
   */
  readonly isConnected: boolean;
  /**
   * Writes raw bytes to the printer and resolves once they have been flushed to
   * the socket. Pass ESC/POS or TSPL command bytes here.
   *
   * Rejects if the connection is closed or the write fails; in that case
   * `isConnected` is `false` and a new connection must be opened.
   *
   * Writes are serialized in call order on the connection's own thread, so
   * consecutive writes cannot interleave on the wire.
   */
  write(data: ArrayBuffer): Promise<void>;
  /**
   * Closes the socket. Resolves once it is closed; calling it on an already
   * closed connection resolves immediately.
   */
  disconnect(): Promise<void>;
}
