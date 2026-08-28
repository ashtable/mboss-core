import {
  access,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
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

  /**
   * The takeover costs one overlap by design: a
   * holder whose section outlives the stale budget
   * keeps running while its successor enters. What
   * it must not cost is the successor's exclusion —
   * a release that deleted whatever lock it found
   * would leave the next caller walking in on the
   * `wx` fast path, with no lock to wait for and no
   * stale check to make it wait.
   */
  it('leaves the lock alone once another holder has taken it over', async () => {
    const path = lockFile(mbossDir);
    const holding = deferred();
    const mayFinish = deferred();
    const tookOver = deferred();
    const successorMayFinish = deferred();

    const first = withLock(mbossDir, async () => {
      holding.resolve();
      await mayFinish.promise;
    });

    await holding.promise;

    const stale = new Date(Date.now() - (STALE_LOCK_MS + 1_000));
    await utimes(path, stale, stale);

    let successorLock = '';
    const second = withLock(mbossDir, async () => {
      successorLock = await readFile(path, 'utf8');
      tookOver.resolve();
      await successorMayFinish.promise;
    });

    await tookOver.promise;

    mayFinish.resolve();
    await first;

    expect(await readFile(path, 'utf8')).toBe(successorLock);

    successorMayFinish.resolve();
    await second;

    expect(await exists(path)).toBe(false);
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
