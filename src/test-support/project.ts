import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mbossDirOf } from '../apply/paths.js';

/**
 * A throwaway mBoss project on disk, for the tests
 * that need one.
 *
 * Every one of those tests writes real files —
 * locks, renames and directory listings are the
 * behaviour under test, and a mocked filesystem
 * would be asserting the mock. So they get a real
 * directory outside the repo, and delete it after.
 */
export type TestProject = { projectDir: string; mbossDir: string };

/**
 * Creates an empty project: a temp directory with
 * a `.mboss/` in it and nothing else. What a
 * caller writes next is what the test is about.
 */
export async function makeProject(): Promise<TestProject> {
  const projectDir = await mkdtemp(join(tmpdir(), 'mboss-'));
  const mbossDir = mbossDirOf(projectDir);

  await mkdir(mbossDir, { recursive: true });

  return { projectDir, mbossDir };
}

/**
 * Removes a project, whatever state it was left
 * in.
 */
export async function removeProject(project: TestProject): Promise<void> {
  await rm(project.projectDir, { recursive: true, force: true });
}
