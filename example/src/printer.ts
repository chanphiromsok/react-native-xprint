import { XPRINTER_P323B, type LabelMedia } from 'react-native-xprint';
import { PrinterSession } from './session/PrinterSession';
import { createFileSystemStorage } from './storage';

/**
 * The label stock this fleet loads by default — a 70x80 mm shipping label,
 * the size `XPRINTER_P323B`'s profile was measured against. A depot manager
 * can change it per printer from `PrinterSettingsScreen`; this is only the
 * starting point for a freshly paired printer.
 */
export const DEFAULT_MEDIA: LabelMedia = {
  widthMm: 70,
  heightMm: 80,
  type: 'printerDefault',
};

/** Presets offered on the label size picker, most common first. */
export const MEDIA_PRESETS: readonly { label: string; media: LabelMedia }[] = [
  { label: '70 x 80 mm (shipping label)', media: DEFAULT_MEDIA },
  {
    label: '50 x 30 mm (small parcel)',
    media: { widthMm: 50, heightMm: 30, type: 'printerDefault' },
  },
  {
    label: '40 x 30 mm (barcode)',
    media: { widthMm: 40, heightMm: 30, type: 'printerDefault' },
  },
];

/**
 * Storage key `PrinterSession` persists the printer registry under, stated
 * explicitly here (rather than relying on the library's default) so the
 * example app always knows exactly where its own data lives on disk.
 */
export const PRINTER_STORAGE_KEY = 'xprint-example.printer';

/**
 * Built once for the lifetime of the app — see `App.tsx`. A module-scope
 * singleton, rather than one constructed inside a component, is what keeps
 * the Bluetooth connection and the in-memory printer list alive across a
 * screen remount.
 */
export const printerSession = new PrinterSession({
  storage: createFileSystemStorage(),
  storageKey: PRINTER_STORAGE_KEY,
  defaultCalibration: XPRINTER_P323B,
  defaultMedia: DEFAULT_MEDIA,
});
