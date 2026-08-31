import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { typecheckProject } from '../compile/typecheck.js';
import { bootProblems } from '../test-support/boot-order.js';
import {
  makeTypecheckProject,
  removeTypecheckProject,
  type TypecheckProject,
} from '../test-support/typecheck.js';

import { scaffoldProject } from './scaffold.js';

/**
 * A project the scaffold made, type-checked
 * against the real typings of everything it
 * imports.
 *
 * The project is created inside this repository,
 * so every bare specifier resolves upward out of
 * the packages already installed here — no
 * install, no network. That is what makes this
 * hermetic, and it is also its blind spot, which
 * `deps.test.ts` and `scripts.test.ts` cover from
 * the other side.
 */

let project: TypecheckProject;

beforeAll(async () => {
  project = await makeTypecheckProject();
  await scaffoldProject(project.projectDir, { name: 'my_app' });
}, 60_000);

afterAll(async () => {
  await removeTypecheckProject(project);
});

describe('a freshly scaffolded project', () => {
  it('type-checks with nothing installed into it', () => {
    const result = typecheckProject(project.projectDir);

    expect(result.ok ? [] : result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  }, 120_000);

  it('has the files that matter inside the program', () => {
    // A gate whose file list came back empty would
    // report clean over nothing at all.
    const result = typecheckProject(project.projectDir);

    for (const path of [
      'src/app/contract.ts',
      'src/app/env.ts',
      'src/app/health.ts',
      'src/app/health.test.ts',
      'src/workflows/index.ts',
      'mboss.config.ts',
      'prisma.config.ts',
      'vitest.config.ts',
    ]) {
      expect(result.checkedFiles).toContain(path);
    }
  }, 120_000);
});

describe('the gate over that project', () => {
  it('reports an ordinary type error, with its file and line', async () => {
    const path = join(project.projectDir, 'src/app/broken.ts');
    await writeFile(path, 'export const n: number = "no";\n', 'utf8');

    try {
      const result = typecheckProject(project.projectDir);

      expect(result.ok).toBe(false);
      expect(result.ok ? [] : result.problems).toContainEqual(
        expect.objectContaining({ file: 'src/app/broken.ts', line: 1 }),
      );
    } finally {
      await rm(path, { force: true });
    }
  }, 120_000);

  it('refuses syntax the runtime cannot strip away', async () => {
    // The app runs under tsx, which strips types
    // with esbuild rather than compiling them, so
    // anything stripping cannot erase has to fail
    // here rather than at container start.
    const path = join(project.projectDir, 'src/app/enum-ish.ts');
    await writeFile(path, 'export enum Colour {\n  Red,\n}\n', 'utf8');

    try {
      const result = typecheckProject(project.projectDir);
      const problems = result.ok ? [] : result.problems;

      expect(problems.map((problem) => problem.file)).toContain(
        'src/app/enum-ish.ts',
      );
    } finally {
      await rm(path, { force: true });
    }
  }, 120_000);

  it('reads the handlers a person writes under lib, too', async () => {
    const dir = join(project.projectDir, 'lib');
    const path = join(dir, 'broken.ts');
    await mkdir(dir, { recursive: true });
    await writeFile(path, 'export const n: number = "no";\n', 'utf8');

    try {
      const result = typecheckProject(project.projectDir);

      expect(result.ok).toBe(false);
      expect(result.checkedFiles).toContain('lib/broken.ts');
    } finally {
      await rm(path, { force: true });
    }
  }, 120_000);
});

describe('the boot sequence', () => {
  const MAIN = join(import.meta.dirname, 'app', 'main.ts');

  it('is not written yet, which is what the check below is waiting for', () => {
    // The runtime task writes app/main.ts. When it
    // lands this fails: delete this test, and the
    // one after it starts checking the real boot
    // order. That failure is the reminder.
    expect(existsSync(MAIN)).toBe(false);
  });

  it.skipIf(!existsSync(MAIN))(
    'creates its schema and listens in order',
    () => {
      expect(bootProblems(readFileSync(MAIN, 'utf8'))).toEqual([]);
    },
  );
});
