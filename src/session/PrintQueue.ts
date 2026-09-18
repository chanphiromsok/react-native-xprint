import type { PrintJob } from './PrintJob';
import type { PrinterStorage } from './PrinterStorage';

const DEFAULT_STORAGE_KEY = 'react-native-xprint.queue';

/**
 * Jobs a `PrinterSession` could not print immediately because the printer
 * was unreachable, kept so they run as soon as it is.
 *
 * A delivery driver who steps out of Bluetooth range mid-round should not
 * lose the job — the round is going to bring them back into range at the
 * next stop or back at the van, and the paperwork should be waiting. `jobs`
 * is ordered oldest first, and callers should print in that order: it is the
 * order the stops happened in, and handing a customer their receipt out of
 * sequence is confusing even when every job eventually prints. This class
 * only holds and persists jobs; deciding when to retry them belongs to
 * `PrinterSession.flush()`.
 */
export class PrintQueue {
  private readonly storage: PrinterStorage;
  private readonly storageKey: string;
  private readonly listeners = new Set<() => void>();

  private currentJobs: PrintJob[] = [];
  /**
   * Seeds the id counter. Combined with `Date.now()` this only has to be
   * unique within this device's queue for this process's lifetime — nothing
   * here is shared across devices — so a simple incrementing counter is
   * enough and avoids pulling in a uuid dependency just for this.
   */
  private nextSequence = 0;

  public constructor(storage: PrinterStorage, storageKey?: string) {
    this.storage = storage;
    this.storageKey = storageKey ?? DEFAULT_STORAGE_KEY;
  }

  public get jobs(): readonly PrintJob[] {
    return this.currentJobs;
  }

  /**
   * Subscribe to any change to `jobs`. Returns an unsubscribe function.
   *
   * Same plain-listener-set shape as `PrinterSession.onChange` — this class
   * has exactly one kind of event, "the job list changed", so a subscriber
   * only needs to know to re-read `jobs`, not which job moved.
   */
  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Loads persisted jobs. Call before using the queue.
   *
   * Kept separate from the constructor because loading is async and a
   * constructor cannot await — `PrinterSession.restore()` calls this itself,
   * so an app assembling its own queue only needs to remember it for a
   * standalone `PrintQueue`.
   */
  public async load(): Promise<void> {
    const raw = await this.storage.getItem(this.storageKey);
    this.currentJobs = raw === null ? [] : (JSON.parse(raw) as PrintJob[]);
    this.notify();
  }

  /** Adds a job to the end of the queue (i.e. it prints last) and persists it. */
  public async enqueue(
    job: Omit<PrintJob, 'id' | 'createdAt'>
  ): Promise<PrintJob> {
    const entry: PrintJob = {
      ...job,
      id: `${Date.now()}-${this.nextSequence}`,
      createdAt: Date.now(),
    };
    this.nextSequence = this.nextSequence + 1;
    this.currentJobs = [...this.currentJobs, entry];
    await this.persist();
    return entry;
  }

  /** Removes one job by id. Does nothing if no job has that id. */
  public async remove(id: string): Promise<void> {
    const next = this.currentJobs.filter((job) => job.id !== id);
    if (next.length === this.currentJobs.length) {
      return;
    }
    this.currentJobs = next;
    await this.persist();
  }

  /** Empties the queue, in memory and in storage. */
  public async clear(): Promise<void> {
    this.currentJobs = [];
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.storage.setItem(
      this.storageKey,
      JSON.stringify(this.currentJobs)
    );
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
