import { open, rm, stat } from 'node:fs/promises';

import { hasCode } from './fs-error.js';
import { lockFile } from './paths.js';

/**
 * The advisory write lock every writer of a
 * workflow document holds.
 *
 * An atomic write stops a reader seeing half a
 * document; it does nothing about two writers
 * losing each other's work. Check-then-write on
 * its own is a race: two writers both read
 * revision 12, both pass a `baseRevision` check,
 * and both write a different revision 13 — the
 * second silently erasing the first. This file
 * supplies the mutual exclusion that makes that
 * impossible, which is what lets `baseRevision` do
 * the job it actually can do: catching a mutation
 * based on content that has since moved on.
 *
 * A file rather than an in-process mutex because
 * the writers are separate processes — an editor,
 * an MCP server, a build.
 */

/**
 * How long a lock may sit untouched before it is
 * presumed to belong to a process that died
 * holding it.
 *
 * This is also what bounds the wait: a holder that
 * never releases stops blocking everyone else
 * after ten seconds, so no caller can wait
 * forever on a crash.
 */
export const STALE_LOCK_MS = 10_000;

/**
 * Retries start fast, because most contention is
 * one short write finishing, and stop growing
 * before the wait becomes noticeable to a person
 * watching a canvas.
 */
const MAX_BACKOFF_MS = 50;

/**
 * Runs `fn` with the project's write lock held,
 * and releases it however `fn` ends.
 *
 * Not reentrant: a second `withLock` inside the
 * body would wait on the lock its own caller
 * holds, until the stale takeover broke it open
 * ten seconds later. Anything that needs to be
 * inside the critical section is called by the
 * body directly, not wrapped again.
 */
export async function withLock<T>(
  mbossDir: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const path = lockFile(mbossDir);

  await acquire(path);

  try {
    return await fn();
  } finally {
    await rm(path, { force: true });
  }
}

async function acquire(path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    if (await create(path)) return;

    // A lock that was stale is gone now, so try
    // for it again rather than sleeping first.
    if (await removeIfStale(path)) continue;

    await sleep(Math.min(2 ** attempt, MAX_BACKOFF_MS));
  }
}

/**
 * `wx` is the whole mechanism: creating the file
 * and failing if it is already there is one step
 * in the filesystem, so two processes calling this
 * at the same instant cannot both succeed.
 *
 * The pid goes in the file for whoever finds one
 * left behind and wants to know who to blame.
 */
async function create(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, 'wx');
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  }

  try {
    await handle.writeFile(String(process.pid), 'utf8');
  } finally {
    await handle.close();
  }

  return true;
}

/**
 * Reports whether the lock is worth trying for
 * again straight away — because it was stale and
 * has been broken, or because its holder released
 * it while we were looking.
 */
async function removeIfStale(path: string): Promise<boolean> {
  let held;
  try {
    held = await stat(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    throw error;
  }

  if (Date.now() - held.mtimeMs < STALE_LOCK_MS) return false;

  await rm(path, { force: true });

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
