/**
 * The one piece of persistence `PrinterSession` needs: somewhere to keep the
 * JSON blob for the printer that was set up, so a driver never re-pairs or
 * re-calibrates on every app launch.
 *
 * This is an adapter rather than a dependency on purpose. The library ships
 * to apps that already picked a storage story — AsyncStorage, MMKV, a SQLite
 * row, a plain file — and none of them should have to add a second one just
 * to keep this package happy. `AsyncStorage` and `MMKV` both satisfy this
 * shape as-is; an app with neither can back it with a file write or its own
 * database in a few lines. `PrinterSession` only ever calls these three
 * methods, so that is all an adapter has to implement.
 */
export interface PrinterStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
