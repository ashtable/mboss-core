import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

/**
 * What a run left on disk: the files under a
 * project, and the state of this repository around
 * it.
 *
 * Two tests ask the second question — whether
 * scaffolding, applying and compiling wrote
 * anything outside the directory they were handed
 * — and a stray absolute path is invisible to
 * every other assertion either of them makes. Two
 * copies of the walk would eventually disagree
 * about which directories to skip, and the one
 * that skipped too much would go quiet about
 * exactly the file it exists to find.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */

/**
 * Directories no walk here descends into: two that
 * belong to tooling, and one that every throwaway
 * project in the suite is created inside — so a
 * concurrently running test file is not mistaken
 * for something this one wrote.
 */
const SKIP = new Set(['node_modules', '.git', '.tmp']);

/** This repository's own root. */
export const REPO_ROOT = resolve(import.meta.dirname, '../..');

/**
 * Every file under `dir`, relative to it and in
 * posix, sorted — with the directories above left
 * alone.
 */
export async function treeOf(dir: string, base = dir): Promise<string[]> {
  const found: string[] = [];

  for (const name of (await readdir(dir)).sort()) {
    if (SKIP.has(name)) continue;

    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) {
      found.push(...(await treeOf(path, base)));
      continue;
    }
    found.push(relative(base, path).split(sep).join('/'));
  }

  return found;
}

/**
 * The repository as it stands: every path, with
 * its size and the moment it was last written.
 *
 * Content is not read. What is being looked for is
 * a file appearing, disappearing or being written
 * to, and all three show here.
 */
export async function repoSnapshot(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};

  for (const rel of await treeOf(REPO_ROOT)) {
    const info = await stat(join(REPO_ROOT, rel));
    found[rel] = `${info.size} ${info.mtimeMs}`;
  }

  return found;
}
