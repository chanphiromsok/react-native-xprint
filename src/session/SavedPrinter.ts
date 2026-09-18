import type { CommandLanguage } from '../types/CommandLanguage';
import type { LabelMedia } from '../types/LabelMedia';
import type { PrinterCalibration } from '../types/PrinterCalibration';

/**
 * Everything `PrinterSession` needs to reconnect and print again without
 * asking the driver anything a second time.
 *
 * That is the entire point of a one-time setup flow: the address to dial
 * back into, the calibration for the hardware model that was paired, the
 * media that was loaded, and the command language that was detected (or
 * left undetermined, so the next connection probes for it again). This is
 * the shape persisted through `PrinterStorage` — nothing here is derived at
 * connect time, so a restored session behaves exactly like the one that was
 * set up.
 */
export interface SavedPrinter {
  address: string;
  name?: string;
  language?: CommandLanguage;
  calibration: PrinterCalibration;
  media?: LabelMedia;
}
