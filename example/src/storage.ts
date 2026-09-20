import { File, Paths } from 'expo-file-system';
import type { PrinterStorage } from './session/PrinterStorage';

/**
 * One small JSON file per key, under the document directory rather than the
 * cache directory — `PrinterStorage` holds the printer registry, which must
 * survive the OS clearing the cache to free space.
 *
 * The key is used as the file name directly. `PrinterSession` only ever
 * passes its own fixed, filesystem-safe storage key (e.g.
 * `'react-native-xprint.printer'`), so no escaping is needed here.
 */
function fileFor(key: string): File {
  return new File(Paths.document, `${key}.json`);
}

/**
 * A `PrinterStorage` backed by `expo-file-system`'s `File` API, so the
 * example app has no dependency on `AsyncStorage` or any other storage
 * library — see `docs/driver-app-integration.md` for why `PrinterStorage`
 * is an adapter in the first place.
 */
export function createFileSystemStorage(): PrinterStorage {
  return {
    async getItem(key: string): Promise<string | null> {
      const file = fileFor(key);
      if (!file.exists) {
        return null;
      }
      return await file.text();
    },

    async setItem(key: string, value: string): Promise<void> {
      const file = fileFor(key);
      // `overwrite: true` makes this safe whether or not the file already
      // exists, so callers never have to check first — `create()` would
      // otherwise throw on the second write to the same key.
      file.create({ overwrite: true, intermediates: true });
      file.write(value);
    },

    async removeItem(key: string): Promise<void> {
      const file = fileFor(key);
      if (file.exists) {
        file.delete();
      }
    },
  };
}
