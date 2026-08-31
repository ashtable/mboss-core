import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { packageOf, specifiersOf } from '../test-support/specifiers.js';

import { scaffoldFiles } from './files.js';

/**
 * The two halves of "a scaffolded project's
 * declared dependencies are enough".
 *
 * A generated project type-checks against this
 * repo's own installed packages, by resolution
 * upward out of the temp directory it is created
 * in. That is what makes the gate hermetic, and it
 * is also its blind spot: a package this repo
 * happens to have would resolve even if the
 * project never declared it.
 *
 * So the imports the copied runtime makes are
 * checked against this repo's declared set here,
 * and against the emitted `package.json` once the
 * scaffold emits one.
 */

const CORE_ROOT = resolve(import.meta.dirname, '../..');

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function declaredIn(pkg: PackageJson): Record<string, string> {
  // The union, not `devDependencies` alone: `zod`
  // and `@types/node` are runtime dependencies of
  // this library and are also packages a generated
  // project imports.
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

const CORE_DEPS = declaredIn(
  JSON.parse(
    readFileSync(join(CORE_ROOT, 'package.json'), 'utf8'),
  ) as PackageJson,
);

/**
 * The ranges a project would declare that this
 * repo does not carry at the identical string.
 *
 * A bump on one side and not the other means the
 * gate is checking generated code against typings
 * the project will never install.
 */
function mirrorProblems(
  emitted: Record<string, string>,
  core: Record<string, string>,
): string[] {
  return Object.entries(emitted)
    .filter(([name, range]) => core[name] !== range)
    .map(([name, range]) => `${name}: project ${range}, core ${core[name]}`);
}

/** Every copied file, and no test file. */
function copiedFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return name === '__snapshots__' ? [] : copiedFiles(path);
    }
    return name.endsWith('.test.ts') ? [] : [path];
  });
}

const IMPORTED = [
  ...new Set(
    ['app', 'workflows']
      .flatMap((dir) => copiedFiles(join(import.meta.dirname, dir)))
      .flatMap((path) => specifiersOf(readFileSync(path, 'utf8')))
      .map(packageOf)
      .filter((name): name is string => name !== null),
  ),
].sort();

describe('what the copied runtime imports', () => {
  it('is declared by this repo, so the gate has its typings', () => {
    const missing = IMPORTED.filter((name) => !(name in CORE_DEPS));

    expect(missing).toEqual([]);
  });

  it('carries the packages a project needs to type-check at all', () => {
    // Not a tautology over IMPORTED: these are the
    // ones a generated project imports whether or
    // not the copied tree does yet, and forgetting
    // one is how the gate starts checking against
    // a package that is not there.
    for (const name of [
      '@dbos-inc/dbos-sdk',
      '@dbos-inc/prisma-datasource',
      '@prisma/adapter-pg',
      '@prisma/client',
      '@types/express',
      '@types/node',
      '@types/pg',
      'dotenv',
      'express',
      'pg',
      'prisma',
      'zod',
    ]) {
      expect(CORE_DEPS).toHaveProperty(name);
    }
  });

  it('pins nothing to a floating range', () => {
    // `prisma` latest is an 8.x pre-release against
    // a 7.x client, `typescript` latest is a major
    // this toolchain cannot run, and `@types/node`
    // latest is far ahead of the pinned runtime.
    for (const [name, range] of Object.entries(CORE_DEPS)) {
      expect(`${name}@${range}`).not.toContain('latest');
      expect(`${name}@${range}`).not.toContain('*');
    }
  });
});

const EMITTED = declaredIn(
  JSON.parse(
    scaffoldFiles({ name: 'my_app' }).find((f) => f.path === 'package.json')
      ?.contents ?? '{}',
  ) as PackageJson,
);

/** Every bare package the emitted tree imports. */
const PROJECT_IMPORTS = [
  ...new Set(
    scaffoldFiles({ name: 'my_app' })
      .filter((file) => /\.(ts|mjs)$/.test(file.path))
      .flatMap((file) => specifiersOf(file.contents))
      .map(packageOf)
      .filter((name): name is string => name !== null),
  ),
].sort();

describe('what a generated project imports', () => {
  it('is a real list, so a clean result is not an empty one', () => {
    expect(PROJECT_IMPORTS).toContain('zod');
    expect(PROJECT_IMPORTS).toContain('vitest');
  });

  it('is declared by the project itself', () => {
    const missing = PROJECT_IMPORTS.filter((name) => !(name in EMITTED));

    expect(missing).toEqual([]);
  });

  it('is carried by this repo at the identical range', () => {
    // Anything else and the type-check gate is
    // checking generated code against typings the
    // project will never install.
    const shared = Object.fromEntries(
      Object.entries(EMITTED).filter(([name]) => name in CORE_DEPS),
    );

    expect(mirrorProblems(shared, CORE_DEPS)).toEqual([]);
  });

  it('adds exactly one package this repo has no reason to carry', () => {
    // Nothing here imports tsx — it is what a
    // container execs — so there is no typing for
    // this repo to mirror.
    const unmirrored = Object.keys(EMITTED).filter(
      (name) => !(name in CORE_DEPS),
    );

    expect(unmirrored).toEqual(['tsx']);
  });

  it('pins nothing to a floating range either', () => {
    for (const [name, range] of Object.entries(EMITTED)) {
      expect(`${name}@${range}`).not.toContain('latest');
      expect(`${name}@${range}`).not.toContain('*');
    }
  });
});

describe('mirrorProblems', () => {
  it('says nothing when the two sides agree', () => {
    const both = { express: '^5.2.1', prisma: '^7.9.1' };

    expect(mirrorProblems(both, both)).toEqual([]);
  });

  it('reports a range that drifted on one side', () => {
    const found = mirrorProblems(
      { express: '^5.2.1', prisma: '^7.9.1' },
      { express: '^5.2.1', prisma: '^8.0.0' },
    );

    expect(found).toEqual(['prisma: project ^7.9.1, core ^8.0.0']);
  });

  it('reports a package the other side does not declare', () => {
    const found = mirrorProblems({ tsx: '^4.20.0' }, {});

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('tsx');
  });
});
