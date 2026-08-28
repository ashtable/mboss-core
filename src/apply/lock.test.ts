import { access, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STALE_LOCK_MS, withLock } from './lock.js';
import { lockFile } from './paths.js';

/**
 * A promise a test resolves by hand, so that
 * "the first holder is inside its body" is a fact
 * rather than a sleep long enough to probably be
 * true.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

/**
 * The lock lives in `.mboss/`, but nothing in this
 * file needs the rest of that directory — the lock
 * is about mutual exclusion, not about workflows.
 */
describe('withLock', () => {
  let mbossDir: string;

  beforeEach(async () => {
    mbossDir = await mkdtemp(join(tmpdir(), 'mboss-'));
  });

  afterEach(async () => {
    await rm(mbossDir, { recursive: true, force: true });
  });

  const exists = async (path: string): Promise<boolean> => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * The second holder is started only once the
   * first is known to be inside its body. Starting
   * both at once would be testing which `open`
   * the operating system happened to serve first,
   * not that the lock excludes anyone.
   */
  it('runs a second holder only after the first returns', async () => {
    const order: string[] = [];
    const holding = deferred();
    const mayFinish = deferred();

    const first = withLock(mbossDir, async () => {
      order.push('first in');
      holding.resolve();
      await mayFinish.promise;
      order.push('first out');
    });

    await holding.promise;

    const second = withLock(mbossDir, () => {
      order.push('second in');
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(['first in']);

    mayFinish.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual(['first in', 'first out', 'second in']);
  });

  it('never lets two bodies overlap', async () => {
    let holders = 0;
    let seenAtOnce = 0;

    const body = async (): Promise<void> => {
      holders += 1;
      seenAtOnce = Math.max(seenAtOnce, holders);
      await new Promise((resolve) => setTimeout(resolve, 5));
      holders -= 1;
    };

    await Promise.all(
      Array.from({ length: 8 }, () => withLock(mbossDir, body)),
    );

    expect(seenAtOnce).toBe(1);
  });

  it('takes over a lock left behind by a crashed holder', async () => {
    const path = lockFile(mbossDir);
    await writeFile(path, '999999', 'utf8');

    const stale = new Date(Date.now() - (STALE_LOCK_MS + 1_000));
    await utimes(path, stale, stale);

    await expect(withLock(mbossDir, () => 'ran')).resolves.toBe('ran');
  });

  it('releases the lock when the body throws', async () => {
    await expect(
      withLock(mbossDir, () => {
        throw new Error('body failed');
      }),
    ).rejects.toThrow('body failed');

    expect(await exists(lockFile(mbossDir))).toBe(false);
  });

  it('leaves no lock behind when the body returns', async () => {
    await withLock(mbossDir, () => undefined);

    expect(await exists(lockFile(mbossDir))).toBe(false);
  });
});
