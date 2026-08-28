import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Writing a file so that no reader can ever see
 * half of it.
 *
 * Every writer in this library goes through here.
 * A workflow document is read without any lock —
 * by the canvas, by an agent, by a build — and a
 * plain `writeFile` truncates before it fills, so
 * a reader landing in that window gets an empty or
 * partial document. A rename over the destination
 * is a single step: a reader sees the old file or
 * the new one.
 *
 * This buys nothing against a *lost update*, which
 * is a different problem with a different answer —
 * see `lock.ts`.
 */

/**
 * Seams for a test to observe the instant between
 * the two steps of the write, which is the only
 * moment at which the guarantee above could fail
 * and the only moment no caller can otherwise
 * see.
 */
export type AtomicWriteHooks = {
  beforeRename?: (tempPath: string) => void | Promise<void>;
};

/**
 * Writes `text` to `path` atomically.
 *
 * The temp file is a sibling of the destination
 * rather than living in the system temp directory:
 * a rename across devices is a copy, and a copy is
 * exactly the torn write this exists to prevent.
 */
export async function writeFileAtomic(
  path: string,
  text: string,
  hooks?: AtomicWriteHooks,
): Promise<void> {
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`,
  );

  try {
    await writeFile(tempPath, text, 'utf8');
    await hooks?.beforeRename?.(tempPath);
    await rename(tempPath, path);
  } catch (error) {
    // A temp file left behind would be swept up by
    // nothing: its name is random, so no later
    // write would ever reuse and replace it.
    await rm(tempPath, { force: true });

    throw error;
  }
}
