import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fixturesRoot } from '../test-support/fixtures.js';
import {
  makeTypecheckProject,
  removeTypecheckProject,
  type TypecheckProject,
} from '../test-support/typecheck.js';
import { typecheckProject } from './typecheck.js';

/**
 * The house `compilerOptions`, as a scaffolded
 * project carries them. The point of the temp
 * project is that nothing is installed into it and
 * nothing is mapped for it — every bare specifier
 * resolves upward, out of this repo's own
 * `node_modules`.
 */
const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2023',
      lib: ['ES2023'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      types: ['node'],
      strict: true,
      noUncheckedIndexedAccess: true,
      verbatimModuleSyntax: true,
      erasableSyntaxOnly: true,
      noEmit: true,
      skipLibCheck: true,
      isolatedModules: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['src'],
  },
  null,
  2,
);

/**
 * A program pulling in the DBOS, Prisma, Express
 * and Node typings takes longer than vitest's
 * five-second default allows.
 */
const SLOW = 60_000;

let project: TypecheckProject | undefined;

afterEach(async () => {
  if (project) await removeTypecheckProject(project);
  project = undefined;
});

async function write(rel: string, contents: string): Promise<string> {
  if (!project) throw new Error('no project');
  const path = join(project.projectDir, rel);

  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents, 'utf8');
  return path;
}

describe('typecheckProject', () => {
  it('type-checks a temp project with nothing installed in it', async () => {
    project = await makeTypecheckProject();
    await write('tsconfig.json', TSCONFIG);
    await write(
      'src/ok.ts',
      [
        "import { readFileSync } from 'node:fs';",
        "import { z } from 'zod';",
        '',
        "export const Name = z.string().parse('a');",
        'export const read = readFileSync;',
        '',
      ].join('\n'),
    );

    const result = typecheckProject(project.projectDir);

    expect(result.ok).toBe(true);
    expect(result.checkedFiles).toContain('src/ok.ts');
  });

  it('resolves a relative import written with a .js extension', async () => {
    project = await makeTypecheckProject();
    await write('tsconfig.json', TSCONFIG);
    await write('src/lib.ts', 'export const answer = 42;\n');
    await write(
      'src/main.ts',
      [
        "import { answer } from './lib.js';",
        '',
        'export const n = answer;',
        '',
      ].join('\n'),
    );

    const result = typecheckProject(project.projectDir);

    expect(result).toEqual({
      ok: true,
      checkedFiles: ['src/lib.ts', 'src/main.ts'],
    });
  });

  it(
    'resolves every package a generated project imports',
    async () => {
      // The hermetic gate, end to end. Nothing is
      // installed into the temp project and
      // nothing is mapped for it: every one of
      // these resolves upward out of this repo,
      // which is the whole reason the project is
      // created inside it.
      //
      // `@prisma/client` is the one that could not
      // work without help — the installed package
      // is a one-line re-export of a client that
      // does not exist until `prisma generate`
      // runs. Naming this repo's own model proves
      // the generated client came from the schema
      // beside it rather than from somewhere else.
      project = await makeTypecheckProject();
      await write('tsconfig.json', TSCONFIG);
      await write(
        'src/app.ts',
        [
          "import 'dotenv/config';",
          "import { DBOS } from '@dbos-inc/dbos-sdk';",
          "import { PrismaDataSource } from '@dbos-inc/prisma-datasource';",
          "import { PrismaPg } from '@prisma/adapter-pg';",
          "import { PrismaClient } from '@prisma/client';",
          "import express from 'express';",
          "import { Pool } from 'pg';",
          '',
          'export const app = express();',
          'export const pool = Pool;',
          'export const adapter = PrismaPg;',
          'export const source = PrismaDataSource;',
          'export const dbos = DBOS;',
          'export const client = new PrismaClient();',
          '',
          'export async function waiting(runId: string, nodeId: string) {',
          '  return client.waitCorrelation.findUnique({',
          '    where: { runId_nodeId: { runId, nodeId } },',
          '  });',
          '}',
          '',
        ].join('\n'),
      );

      const result = typecheckProject(project.projectDir);

      expect(result).toEqual({ ok: true, checkedFiles: ['src/app.ts'] });
    },
    SLOW,
  );

  it('reports the broken fixture with its file and line', () => {
    const result = typecheckProject(join(fixturesRoot, 'typecheck-broken'));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.checkedFiles).toEqual(['src/bad.ts']);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.file).toBe('src/bad.ts');
    expect(result.problems[0]?.line).toBe(5);
    expect(result.problems[0]?.message).toContain('not assignable');
  });

  it('reports a project whose tsconfig cannot be read', async () => {
    project = await makeTypecheckProject();

    const result = typecheckProject(project.projectDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('tsconfig.json');
  });

  it('flattens a diagnostic chain into one line', async () => {
    project = await makeTypecheckProject();
    await write('tsconfig.json', TSCONFIG);
    await write(
      'src/chain.ts',
      [
        'type Held = { inner: { deep: string } };',
        '',
        'declare function take(held: Held): void;',
        '',
        'const value = { inner: { deep: 1 } };',
        'take(value);',
        '',
      ].join('\n'),
    );

    const result = typecheckProject(project.projectDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message = result.problems[0]?.message ?? '';
    expect(message).not.toContain('\n');
    expect(message).toContain('is not assignable to parameter');
    expect(message).toContain("Type 'number' is not assignable");
  });
});
