import {
  Xprinter,
  describePrinterProblem,
  printPdfAsLabel,
  printPdfAsReceipt,
  XPRINTER_P323B,
  type BluetoothPrinter,
  type CommandLanguage,
  type ImageJobOptions,
  type LabelMedia,
  type PrinterCalibration,
  type PrinterProblem,
} from 'react-native-xprint';
import type { PrintOptions } from './PrintOptions';
import type { PrinterConnectionState } from './PrinterConnectionState';
import type { PrinterRegistry } from './PrinterRegistry';
import { removePrinter, upsertPrinter } from './PrinterRegistry';
import type { PrinterStorage } from './PrinterStorage';
import type { SavedPrinter } from './SavedPrinter';

const DEFAULT_STORAGE_KEY = 'react-native-xprint.printer';

/**
 * What a `PrinterSession` needs at construction time.
 *
 * Only `storage` is required — everything else has a default sane enough for
 * a single supported printer model, because the whole point of this layer is
 * that an app assembling a "tap to print" button should not have to think
 * about calibration or media at all.
 */
export interface PrinterSessionOptions {
  storage: PrinterStorage;
  /** Storage key. Defaults to 'react-native-xprint.printer'. */
  storageKey?: string;
  /** Calibration applied to a newly set-up printer. Defaults to XPRINTER_P323B. */
  defaultCalibration?: PrinterCalibration;
  /** Media applied to a newly set-up printer. */
  defaultMedia?: LabelMedia;
}

/**
 * Owns the connection lifecycle for the printers a driver-facing app cares
 * about, so a UI layer never touches `Xprinter.connect` or a raw
 * `BluetoothPrinter` directly.
 *
 * This is the piece that turns "developer must handle MAC addresses,
 * language detection, calibration and media" into "tap the button, it
 * prints" — it remembers which printers were paired, reapplies their
 * settings on every reconnect, and translates whatever goes wrong into a
 * `PrinterProblem` a non-technical screen can render. It is deliberately
 * framework-agnostic: no React here, so it can back a hook, a store, or a
 * plain script equally well.
 *
 * A driver may work from several vans over a week, or share a depot
 * printer with other drivers, so this remembers a whole list of printers
 * (`printers`) rather than one, with exactly one of them `active` at a
 * time — see `PrinterRegistry` for why. But only one connection is ever
 * open: Bluetooth Classic will not reliably hold two RFCOMM sockets from a
 * single phone, and a driver only ever prints to whatever is in front of
 * them, never two printers at once.
 *
 * Every public async method follows the same contract: on failure it
 * records `problem`, moves to `'failed'`, and rethrows — so a caller that
 * wants to react immediately can `await` and `catch`, and a caller that only
 * renders state can ignore the throw and read `problem` from `onChange`.
 * `restore()` is the one exception, documented on it, because an unreachable
 * printer at app start is routine rather than exceptional.
 */
export class PrinterSession {
  private readonly storage: PrinterStorage;
  private readonly storageKey: string;
  private readonly defaultCalibration: PrinterCalibration;
  private readonly defaultMedia: LabelMedia | undefined;

  private currentState: PrinterConnectionState = 'unconfigured';
  /** Most recently set up (or re-configured) first — see `PrinterRegistry`. */
  private currentPrinters: SavedPrinter[] = [];
  private currentActiveAddress: string | undefined;
  private currentProblem: PrinterProblem | undefined;

  private printer: BluetoothPrinter | undefined;
  /**
   * The in-flight connect attempt, if any. A second RFCOMM connect to the
   * same device fails while the first is still opening, so every path that
   * needs a connection awaits this instead of starting its own.
   */
  private connecting: Promise<BluetoothPrinter> | undefined;
  private readonly listeners = new Set<() => void>();

  public constructor(options: PrinterSessionOptions) {
    this.storage = options.storage;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.defaultCalibration = options.defaultCalibration ?? XPRINTER_P323B;
    this.defaultMedia = options.defaultMedia;
  }

  public get state(): PrinterConnectionState {
    return this.currentState;
  }

  /** Every printer set up on this device, most recently set up first. */
  public get printers(): readonly SavedPrinter[] {
    return this.currentPrinters;
  }

  /** The printer `print()` will use, or undefined when none is set up. */
  public get active(): SavedPrinter | undefined {
    return this.currentPrinters.find(
      (printer) => printer.address === this.currentActiveAddress
    );
  }

  public get problem(): PrinterProblem | undefined {
    return this.currentProblem;
  }

  /**
   * Subscribe to any state/printers/active/problem change. Returns an
   * unsubscribe function.
   *
   * A plain listener set rather than an event-emitter dependency: this class
   * has exactly one kind of event — "something a UI reads has changed" — so
   * a subscriber does not need to know which field moved, only that it
   * should re-read `state` / `printers` / `active` / `problem`.
   */
  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Loads the saved printer registry and connects to whichever printer is
   * active. Safe to call on app start.
   *
   * Unlike every other public method here, a connection failure does not
   * throw: an app launching out of range of its printer is the normal case
   * for a delivery driver, not a bug, so `restore()` settles into `'offline'`
   * with `problem` set and lets the caller decide whether to retry, prompt
   * for setup, or just show a badge. A genuinely unexpected failure — the
   * storage adapter itself throwing, a corrupted saved record — still
   * follows the usual `'failed'` + rethrow contract.
   */
  public async restore(): Promise<void> {
    try {
      const raw = await this.storage.getItem(this.storageKey);
      if (raw === null) {
        this.currentPrinters = [];
        this.currentActiveAddress = undefined;
        this.setState('unconfigured');
        return;
      }
      const registry = JSON.parse(raw) as PrinterRegistry;
      this.currentPrinters = registry.printers;
      this.currentActiveAddress = registry.activeAddress;
      const active = this.active;
      if (active === undefined) {
        this.setState('unconfigured');
        return;
      }
      this.setState('connecting');
      try {
        await this.openConnection(active);
        this.setState('ready');
      } catch (error) {
        this.currentProblem = describePrinterProblem(error);
        this.setState('offline');
      }
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * Sets up a printer: connects, detects the command language, applies the
   * default calibration and media, adds it to `printers` (replacing any
   * existing entry with the same address), and makes it the active one.
   *
   * The language probe can be inconclusive — see `LanguageProbe.likely` —
   * and that is not a setup failure: the printer still gets calibrated,
   * saved, and marked ready, just without a declared language until a later
   * detection succeeds or the driver's own choice sets one.
   */
  public async setUp(address: string, name?: string): Promise<void> {
    try {
      // A connect started by restore() may still be opening a socket to the
      // previous printer; a second RFCOMM connect while one is in flight fails.
      await this.settleInFlightConnect();
      this.setState('connecting');
      const printer = await Xprinter.connect(address);
      this.printer = printer;

      const probe = await printer.detectLanguage();
      if (probe.likely !== undefined) {
        printer.declareLanguage(probe.likely);
      }
      printer.calibration = this.defaultCalibration;
      if (this.defaultMedia !== undefined) {
        printer.media = this.defaultMedia;
      }

      const saved: SavedPrinter = {
        address,
        name,
        language: probe.likely,
        calibration: this.defaultCalibration,
        media: this.defaultMedia,
      };
      await this.persistRegistry({
        printers: upsertPrinter(this.currentPrinters, saved),
        activeAddress: address,
      });
      this.setState('ready');
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * Reconnects to the active printer.
   */
  public async connect(): Promise<void> {
    try {
      const active = this.requireActive();
      this.setState('connecting');
      await this.openConnection(active);
      this.setState('ready');
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * Switches the active printer, disconnecting the previous one first.
   *
   * Only one connection is ever open: Bluetooth Classic will not reliably
   * hold two RFCOMM sockets from a single phone, and a driver only ever
   * prints to whatever printer is in front of them right now — the van's
   * mounted unit, or today's depot printer, never both at once.
   */
  public async select(address: string): Promise<void> {
    try {
      const target = this.currentPrinters.find(
        (printer) => printer.address === address
      );
      if (target === undefined) {
        throw new Error(`No printer set up with address ${address}.`);
      }
      // Let a connect already in flight (to the printer being switched away
      // from) settle before tearing down its socket out from under it.
      await this.settleInFlightConnect();
      if (this.printer !== undefined) {
        await this.printer.disconnect();
        this.printer = undefined;
      }
      await this.persistRegistry({
        printers: this.currentPrinters,
        activeAddress: address,
      });
      this.setState('connecting');
      await this.openConnection(target);
      this.setState('ready');
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * Prints a PDF or image, connecting first if needed.
   *
   * A failure here always follows the usual `fail()` + rethrow contract —
   * this does not queue or retry. Retry/queue policy is a product decision
   * (should a failed print wait silently for the printer to come back, or
   * surface immediately?) that varies by app, not something this library
   * should impose. A caller that wants to queue a retryable failure — see
   * `describePrinterProblem(error).retryable` — is free to build that on top
   * of this method; it just is not baked in here.
   */
  public async print(
    source: string,
    options: PrintOptions = {}
  ): Promise<void> {
    const { overrides, copies = 1 } = options;
    try {
      await this.attemptPrint(source, overrides, copies);
      this.setState('ready');
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * Forgets one printer, defaulting to the active one.
   *
   * Removing the active printer disconnects it — a socket to a printer
   * nothing addresses anymore has no reason to stay open — and hands
   * `active` to the most recently set-up printer still on the list, the
   * same recency order `printers` is kept in (see `removePrinter`). That
   * promoted printer is left unconnected rather than dialled automatically:
   * forgetting a printer is a deletion, not a "come back online" moment
   * like `connect()` or `select()`, so this does not guess that the driver
   * wants to talk to a different printer right now. The session reports
   * `'offline'` — a printer is set up and reachable in principle, just not
   * connected — with no `problem`, since nothing failed. When no printer is
   * left, it moves to `'unconfigured'` instead, matching a fresh install.
   *
   * Forgetting a printer that is not active only removes it from the list;
   * the active printer and the open connection, if any, are untouched.
   */
  public async forget(address?: string): Promise<void> {
    try {
      const target = address ?? this.currentActiveAddress;
      if (target === undefined) {
        return;
      }
      const wasActive = target === this.currentActiveAddress;
      if (wasActive) {
        // A connect started by restore() or connect() may still be opening
        // a socket to this same printer; settle it before disconnecting.
        await this.settleInFlightConnect();
        if (this.printer !== undefined) {
          await this.printer.disconnect();
          this.printer = undefined;
        }
      }
      const registry = removePrinter(
        {
          printers: this.currentPrinters,
          activeAddress: this.currentActiveAddress,
        },
        target
      );
      await this.persistRegistry(registry);
      if (!wasActive) {
        return;
      }
      this.currentProblem = undefined;
      this.setState(
        registry.activeAddress === undefined ? 'unconfigured' : 'offline'
      );
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Forgets every printer and disconnects. */
  public async forgetAll(): Promise<void> {
    try {
      await this.settleInFlightConnect();
      if (this.printer !== undefined) {
        await this.printer.disconnect();
        this.printer = undefined;
      }
      await this.persistRegistry({ printers: [], activeAddress: undefined });
      this.setState('unconfigured');
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Updates the active printer's saved media (e.g. the driver changed the roll) and persists it. */
  public async setMedia(media: LabelMedia): Promise<void> {
    try {
      const active = this.requireActive();
      if (this.printer !== undefined) {
        this.printer.media = media;
      }
      await this.persistPrinterUpdate({ ...active, media });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * The actual work of printing a source once a printer is assumed
   * reachable.
   *
   * Both `printPdfAsLabel` and `printPdfAsReceipt` take a `copies` count
   * directly, so this just picks the branch for the resolved language and
   * passes it through — no looping needed here.
   */
  private async attemptPrint(
    source: string,
    overrides: Partial<ImageJobOptions> | undefined,
    copies: number
  ): Promise<void> {
    const printer = await this.ensureConnected();
    const language = await this.resolveLanguage(printer);
    this.setState('printing');
    if (language === 'tspl') {
      await printPdfAsLabel(printer, source, overrides, copies);
    } else {
      await printPdfAsReceipt(printer, source, overrides, copies);
    }
  }

  /**
   * Returns a connection to the saved printer, reusing one already open and
   * joining an in-flight attempt rather than racing a second connect against
   * it — a second RFCOMM connect to a device that is still opening its first
   * one fails outright.
   */
  private async ensureConnected(): Promise<BluetoothPrinter> {
    if (this.printer !== undefined && this.printer.isConnected) {
      return this.printer;
    }
    const active = this.requireActive();
    this.setState('connecting');
    return this.openConnection(active);
  }

  /**
   * Waits for any in-flight connect to finish, succeed or fail.
   *
   * Its outcome is deliberately discarded: the caller is about to connect to a
   * different device, and only needs the radio free.
   */
  private async settleInFlightConnect(): Promise<void> {
    const attempt = this.connecting;
    if (attempt === undefined) {
      return;
    }
    await attempt.catch(() => undefined);
  }

  private openConnection(saved: SavedPrinter): Promise<BluetoothPrinter> {
    if (this.connecting !== undefined) {
      return this.connecting;
    }
    const attempt = this.doConnect(saved).finally(() => {
      this.connecting = undefined;
    });
    this.connecting = attempt;
    return attempt;
  }

  /**
   * Opens the socket and reapplies everything that lives on the connection
   * rather than on the printer itself — calibration, media and the declared
   * language all reset on a fresh `BluetoothPrinter`, so every reconnect has
   * to restate them for the printer to behave the way it did when it was set
   * up.
   */
  private async doConnect(saved: SavedPrinter): Promise<BluetoothPrinter> {
    const printer = await Xprinter.connect(saved.address);
    printer.calibration = saved.calibration;
    if (saved.media !== undefined) {
      printer.media = saved.media;
    }
    if (saved.language !== undefined) {
      printer.declareLanguage(saved.language);
    }
    this.printer = printer;
    return printer;
  }

  /**
   * The command language this connection is speaking, probing if it is not
   * already known and remembering a conclusive answer.
   *
   * Never guesses. A printer silently discards a job written in a language it
   * is not in, so defaulting to one would turn "the wrong printer mode" into
   * "nothing came out and nothing said why" — the single most expensive
   * failure this library has to prevent.
   */
  private async resolveLanguage(
    printer: BluetoothPrinter
  ): Promise<CommandLanguage> {
    const known = printer.language;
    if (known !== undefined) {
      return known;
    }
    const probe = await printer.detectLanguage();
    if (probe.likely === undefined) {
      throw new Error(
        'Could not tell which command language this printer is in, so a job ' +
          'would be silently discarded rather than printed.'
      );
    }
    await this.persistPrinterUpdate({
      ...this.requireActive(),
      language: probe.likely,
    });
    return probe.likely;
  }

  private requireActive(): SavedPrinter {
    const active = this.active;
    if (active === undefined) {
      throw new Error('No printer has been set up yet.');
    }
    return active;
  }

  /**
   * Persists the whole registry and updates the in-memory view to match —
   * every mutation (`setUp`, `select`, `forget`, `forgetAll`, and edits
   * routed through `persistPrinterUpdate`) funnels through here so storage
   * and memory can never drift apart.
   */
  private async persistRegistry(registry: PrinterRegistry): Promise<void> {
    await this.storage.setItem(this.storageKey, JSON.stringify(registry));
    this.currentPrinters = registry.printers;
    this.currentActiveAddress = registry.activeAddress;
    this.notify();
  }

  /**
   * Persists an in-place edit to one entry already on the list — a language
   * detection or a media change — without disturbing list order or which
   * printer is active.
   *
   * `upsertPrinter` is for `setUp`, where surfacing the newly (re)paired
   * printer first is the point; using it here too would reshuffle a
   * driver's printer list every time a background language probe resolves.
   */
  private async persistPrinterUpdate(updated: SavedPrinter): Promise<void> {
    const printers = this.currentPrinters.map((printer) =>
      printer.address === updated.address ? updated : printer
    );
    await this.persistRegistry({
      printers,
      activeAddress: this.currentActiveAddress,
    });
  }

  /**
   * Moves to a new state, clearing any previous problem on the way.
   *
   * A stale `problem` alongside a `'ready'` state would have a UI showing an
   * error next to a working printer. The two states that carry a problem —
   * `'failed'` and `'offline'` — set it themselves and are excluded here.
   */
  private setState(state: PrinterConnectionState): void {
    if (state !== 'failed' && state !== 'offline') {
      this.currentProblem = undefined;
    }
    this.currentState = state;
    this.notify();
  }

  /**
   * Records a failed operation's outcome without routing back through
   * `setState`, so a failure notifies listeners exactly once instead of once
   * for a transient `'connecting'`/`'printing'` state and once for the error.
   */
  private fail(error: unknown): void {
    this.currentProblem = describePrinterProblem(error);
    this.currentState = 'failed';
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
