import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { mbossDirOf } from '../apply/paths.js';

/**
 * Throwaway generated projects, for the tests that
 * type-check one.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */

/**
 * Where a throwaway project is created: inside
 * this repo, not the system temp directory.
 *
 * That is the whole hermetic type-check strategy
 * in one constant. Node and TypeScript both walk
 * parent directories looking for `node_modules`,
 * so from here every bare specifier a generated
 * project imports resolves out of this repo's own
 * installed packages — no install, no network, no
 * symlink farm and no `paths` overlay.
 */
export const TYPECHECK_ROOT = resolve(import.meta.dirname, '../../.tmp');

export type TypecheckProject = { projectDir: string; mbossDir: string };

/**
 * An empty directory and nothing else — not even
 * `.mboss/`.
 *
 * `makeProject` in `project.ts` pre-creates that
 * directory, which is right for the tests that
 * read and write documents in an existing project
 * and wrong here: it would hide the fact that
 * scaffolding has to create it, and it would trip
 * the scaffold's refusal to write over a project
 * that already exists.
 */
export async function makeTypecheckProject(): Promise<TypecheckProject> {
  await mkdir(TYPECHECK_ROOT, { recursive: true });
  const projectDir = await mkdtemp(join(TYPECHECK_ROOT, 'proj-'));

  return { projectDir, mbossDir: mbossDirOf(projectDir) };
}

export async function removeTypecheckProject(
  project: TypecheckProject,
): Promise<void> {
  await rm(project.projectDir, { recursive: true, force: true });
}
