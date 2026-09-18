import { describe, expect, it } from '@jest/globals';
import { PrintQueue } from '../session/PrintQueue';
import type { PrinterStorage } from '../session/PrinterStorage';

/**
 * A `PrinterStorage` backed by a plain `Map`, standing in for AsyncStorage
 * or MMKV so these tests can exercise `PrintQueue`'s persistence without a
 * real native module. Two `PrintQueue` instances can share one `Map` the
 * same way two app launches share one AsyncStorage, which is what the
 * `load()` test below relies on.
 */
function createInMemoryStorage(): PrinterStorage {
  const store = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

describe('PrintQueue', () => {
  it('returns an enqueued job from jobs', async () => {
    const queue = new PrintQueue(createInMemoryStorage());
    await queue.load();

    const job = await queue.enqueue({ source: 'file:///a.pdf', copies: 1 });

    expect(queue.jobs).toEqual([job]);
  });

  it('orders jobs oldest first across several enqueues', async () => {
    const queue = new PrintQueue(createInMemoryStorage());
    await queue.load();

    const first = await queue.enqueue({ source: 'file:///a.pdf', copies: 1 });
    const second = await queue.enqueue({ source: 'file:///b.pdf', copies: 1 });
    const third = await queue.enqueue({ source: 'file:///c.pdf', copies: 1 });

    expect(queue.jobs.map((job) => job.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it('remove drops only the named job', async () => {
    const queue = new PrintQueue(createInMemoryStorage());
    await queue.load();

    const first = await queue.enqueue({ source: 'file:///a.pdf', copies: 1 });
    const second = await queue.enqueue({ source: 'file:///b.pdf', copies: 1 });

    await queue.remove(first.id);

    expect(queue.jobs).toEqual([second]);
  });

  it('load restores jobs persisted by a previous instance', async () => {
    const storage = createInMemoryStorage();
    const first = new PrintQueue(storage);
    await first.load();
    const job = await first.enqueue({ source: 'file:///a.pdf', copies: 2 });

    const second = new PrintQueue(storage);
    await second.load();

    expect(second.jobs).toEqual([job]);
  });

  it('clear empties both memory and storage', async () => {
    const storage = createInMemoryStorage();
    const first = new PrintQueue(storage);
    await first.load();
    await first.enqueue({ source: 'file:///a.pdf', copies: 1 });

    await first.clear();

    expect(first.jobs).toEqual([]);

    const second = new PrintQueue(storage);
    await second.load();
    expect(second.jobs).toEqual([]);
  });

  it('onChange fires on enqueue and remove, and unsubscribe stops it', async () => {
    const queue = new PrintQueue(createInMemoryStorage());
    await queue.load();

    let calls = 0;
    const unsubscribe = queue.onChange(() => {
      calls = calls + 1;
    });

    const job = await queue.enqueue({ source: 'file:///a.pdf', copies: 1 });
    expect(calls).toBe(1);

    await queue.remove(job.id);
    expect(calls).toBe(2);

    unsubscribe();
    await queue.enqueue({ source: 'file:///b.pdf', copies: 1 });
    expect(calls).toBe(2);
  });
});
