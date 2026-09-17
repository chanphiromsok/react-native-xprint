import type { HybridObject } from 'react-native-nitro-modules';
import type { BluetoothDeviceInfo } from '../types/BluetoothDeviceInfo';
import type { CommandLanguage } from '../types/CommandLanguage';
import type { LabelMedia } from '../types/LabelMedia';
import type { LanguageProbe } from '../types/LanguageProbe';
import type { PrinterCalibration } from '../types/PrinterCalibration';

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
   * The printer's fixed physical characteristics — resolution, printable width,
   * origin offset, orientation.
   *
   * Defaults to a 203 dpi head with no offset and no rotation. Set it once after
   * connecting; it describes the hardware, so nothing about a job or the loaded
   * paper should ever change it.
   */
  calibration: PrinterCalibration;
  /**
   * The label stock currently loaded, or `undefined` on a receipt printer and
   * before it has been set.
   *
   * Set this when the roll is swapped and every subsequent job resizes and
   * re-centers itself — no call site needs to change.
   */
  media?: LabelMedia;
  /**
   * The command language this connection is known to be speaking, or `undefined`
   * until it has been detected or declared.
   *
   * Set by a conclusive {@linkcode detectLanguage} and by
   * {@linkcode declareLanguage}. Read it before building a job: sending a job in
   * the wrong language is silently discarded by the printer.
   */
  readonly language?: CommandLanguage;
  /**
   * Records the language to use for this connection, skipping detection.
   *
   * Use it when the hardware is known, and to override an inconclusive or wrong
   * probe — the printer's own menu is the final authority, not the probe.
   */
  declareLanguage(language: CommandLanguage): void;
  /**
   * Reads whatever the printer has sent back, up to `maxBytes`, giving up after
   * `timeoutMs` and resolving with however much arrived — an empty buffer when
   * nothing did.
   *
   * Reads are serialized with `write` on the same connection thread, so a write
   * followed by a read behaves as a query and its reply.
   *
   * There is only one input stream, so only one reader: do not run two reads
   * concurrently or they will split a reply between them.
   */
  read(maxBytes: number, timeoutMs: number): Promise<ArrayBuffer>;
  /**
   * Works out which command language the printer is currently interpreting, by
   * asking each one for its status and seeing which answers.
   *
   * Costs no paper on an ESC/POS printer. On a printer that answers neither
   * query, the TSPL probe leaves a short line of text on the paper — the price
   * of finding out.
   *
   * The result is evidence, not proof; see {@linkcode LanguageProbe}.
   */
  detectLanguage(): Promise<LanguageProbe>;
  /**
   * Closes the socket. Resolves once it is closed; calling it on an already
   * closed connection resolves immediately.
   */
  disconnect(): Promise<void>;
}
