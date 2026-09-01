import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  WorkflowSpecSchema,
  applySpec,
  type ApplyOutcome,
  type ParsedWorkflowSpec,
} from '../apply/index.js';
import { scanLib } from '../manifest/index.js';
import { scaffoldProject } from '../scaffold/index.js';
import { copyFixtureLib, readFixtureJson } from '../test-support/fixtures.js';
import { eslintProblems, prettierProblems } from '../test-support/lint.js';
import { relativeSpecifiersEndInJs } from '../test-support/specifiers.js';
import { citationProblems, widthProblems } from '../test-support/style.js';
import {
  makeTypecheckProject,
  removeTypecheckProject,
  type TypecheckProject,
} from '../test-support/typecheck.js';

import { compileProject, type CompileProjectResult } from './compile.js';
import { typecheckProject } from './typecheck.js';

/**
 * The whole chain, once, against a real project on
 * disk: scaffold, apply, compile, type-check.
 *
 * Every other test in this repository holds one
 * end of the seam still. The compiler's goldens
 * are compared against text; the scaffold's are
 * compared against text; the type-check gate is
 * handed files a test wrote. Nothing else asks
 * whether the two halves, put together by the same
 * calls a user's tooling makes, produce a project
 * that compiles — and that is the only question
 * whose answer a person would notice.
 *
 * It runs hermetically: no network, no database,
 * no container. The temp project is created inside
 * this repository so every package a generated
 * project imports resolves upward out of the
 * packages already installed here.
 */

const TIMEZONE = 'America/Los_Angeles';

/**
 * The three documents, chosen for what they make
 * the compiler emit rather than for variety: an
 * event wait inside a bounded loop with a
 * transaction and an email after it, a form wait
 * whose token is minted by the email before it,
 * and an approval that desugars into a wait of its
 * own.
 */
const WORKFLOWS = ['approval_flow', 'form_intake', 'groom_booking'] as const;

/**
 * A workflow spec is the document minus its
 * envelope, and the schema is what says which
 * fields those are: parsing through it strips the
 * `$schema`, `version`, `revision` and `name` the
 * fixture carries, which is exactly what a caller
 * hands `applySpec`.
 */
function specOf(name: string): ParsedWorkflowSpec {
  return WorkflowSpecSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

/**
 * Every file in the project, project-relative and
 * posix, with the directories a project is told to
 * leave alone left out.
 */
async function treeOf(dir: string, base = dir): Promise<string[]> {
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
 * Directories no walk here descends into: two that
 * belong to tooling, and one that every throwaway
 * project in the suite is created inside — so a
 * concurrently running test file is not mistaken
 * for something this one wrote.
 */
const SKIP = new Set(['node_modules', '.git', '.tmp']);

const REPO = resolve(import.meta.dirname, '../..');

/**
 * The repository as it stands: every path, with
 * its size and the moment it was last written.
 *
 * Content is not read. What is being looked for is
 * a file appearing, disappearing or being written
 * to, and all three show here.
 */
async function repoSnapshot(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};

  for (const rel of await treeOf(REPO)) {
    const info = await stat(join(REPO, rel));
    found[rel] = `${info.size} ${info.mtimeMs}`;
  }

  return found;
}

let REPO_BEFORE: Record<string, string>;
let project: TypecheckProject;
let applied: ApplyOutcome[];
let compiled: CompileProjectResult;

/**
 * What the compiler wrote, by path, so a second
 * run can be compared against the first.
 */
async function generatedFiles(): Promise<Record<string, string>> {
  const dir = join(project.projectDir, 'src', 'workflows');
  const found: Record<string, string> = {};

  for (const name of (await readdir(dir)).sort()) {
    found[name] = await readFile(join(dir, name), 'utf8');
  }

  return found;
}

/**
 * The whole project, as the two lint runners want
 * it: a path and its bytes.
 */
async function lintFiles(): Promise<{ path: string; contents: string }[]> {
  const files = [];

  for (const rel of await treeOf(project.projectDir)) {
    files.push({
      path: rel,
      contents: await readFile(join(project.projectDir, rel), 'utf8'),
    });
  }

  return files;
}

beforeAll(async () => {
  REPO_BEFORE = await repoSnapshot();
  project = await makeTypecheckProject();

  await scaffoldProject(project.projectDir, { name: 'fixture_app' });
  copyFixtureLib(project.projectDir);

  const manifest = scanLib(join(project.projectDir, 'lib'));

  // In sequence, never nested: `applySpec` takes
  // the project lock and releases it, and the lock
  // is not reentrant.
  applied = [];
  for (const name of WORKFLOWS) {
    applied.push(
      await applySpec(
        project.mbossDir,
        { name, spec: specOf(name), baseRevision: null },
        { manifest },
      ),
    );
  }

  compiled = await compileProject(project.projectDir, { timezone: TIMEZONE });
}, 180_000);

afterAll(async () => {
  if (project) await removeTypecheckProject(project);
});

describe('a scaffolded project with three workflows applied', () => {
  it('applies every fixture through the real validation gate', () => {
    // A fixture the gate refuses is a broken
    // fixture. Routing around it here would mean
    // the rest of this file proves something
    // about a document nobody could save. The
    // refusal is what is compared against, so a
    // failure reads as the diagnostic it was.
    expect(
      applied.map((outcome) => (outcome.ok ? outcome.ir.name : outcome.error)),
    ).toEqual([...WORKFLOWS]);
  });

  it('compiles all three and writes the registry', () => {
    expect(compiled.ok ? [] : compiled.failures).toEqual([]);
    expect(compiled.ok && compiled.written).toEqual([
      'src/workflows/approval_flow.workflow.ts',
      'src/workflows/form_intake.workflow.ts',
      'src/workflows/groom_booking.workflow.ts',
      'src/workflows/index.ts',
    ]);
  });

  it('carries each document title into the registry, not the slug', async () => {
    // The titles are what a person reads, and this
    // is the only place one crosses from a workflow
    // document into emitted code. Every other
    // assertion about the registry here is about a
    // name, which is what a broken derivation would
    // produce anyway.
    const registry = await readFile(
      join(project.projectDir, 'src', 'workflows', 'index.ts'),
      'utf8',
    );

    expect(registry).toContain("    title: 'Expense approval',");
    expect(registry).toContain("    title: 'Intake form',");
    expect(registry).toContain("    title: 'Groom booking',");
  });

  it.each(WORKFLOWS)('opens %s with the do-not-edit header', async (name) => {
    const source = await readFile(
      join(project.projectDir, 'src', 'workflows', `${name}.workflow.ts`),
      'utf8',
    );

    expect(source.split('\n').slice(0, 4)).toEqual([
      '// GENERATED BY MBOSS — DO NOT EDIT.',
      '// Regenerated from',
      `// .mboss/workflows/${name}.workflow.json.`,
      '',
    ]);
  });

  it('type-checks, and over the files it just wrote', () => {
    const result = typecheckProject(project.projectDir);

    // The problems are printed rather than
    // summarised: "type errors" would send a
    // reader back to run this by hand, and the
    // whole point of the gate is that it says
    // what is wrong.
    expect(result.ok ? [] : result.problems).toEqual([]);
    expect(result.ok).toBe(true);

    // Every path the compiler just wrote, and
    // then one file from the runtime and one from
    // the code-behind: between them they say the
    // whole project was compiled rather than the
    // part this test wrote.
    for (const path of [
      ...(compiled.ok ? compiled.written : []),
      'src/app/main.ts',
      'lib/parseRequest.ts',
    ]) {
      expect(result.checkedFiles).toContain(path);
    }
  }, 120_000);

  it('is looking at the tree, not at an empty file list', async () => {
    // The gate reports over a program it builds
    // from the project's own `tsconfig`. Nothing
    // else here would notice a program with no
    // root files in it, and a clean answer over
    // nothing is the one failure mode a gate
    // cannot survive.
    const source = join(project.projectDir, 'lib', 'parseRequest.ts');
    const original = await readFile(source, 'utf8');
    const broken = original.replace(
      'export function parseRequest',
      'const wrong: number = "not a number";\n\nexport function parseRequest',
    );

    expect(broken).not.toBe(original);
    await writeFile(source, broken, 'utf8');

    let result;
    try {
      result = typecheckProject(project.projectDir);
    } finally {
      await writeFile(source, original, 'utf8');
    }

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.file).toBe('lib/parseRequest.ts');
    expect(result.problems[0]?.line).toBe(
      broken.split('\n').findIndex((line) => line.startsWith('const wrong')) +
        1,
    );
    expect(result.problems[0]?.message).toContain('not assignable');
  }, 120_000);

  it('regenerates byte for byte', async () => {
    // The header carries no timestamp and the
    // compiler reads no clock, so a second run
    // over an unchanged project has to produce
    // the same bytes. CI asserts this, and it is
    // what makes a diff under `src/workflows`
    // mean somebody changed a workflow.
    const before = await generatedFiles();
    const again = await compileProject(project.projectDir, {
      timezone: TIMEZONE,
    });

    expect(again.ok ? [] : again.failures).toEqual([]);
    expect(again.ok && again.removed).toEqual([]);
    expect(await generatedFiles()).toEqual(before);
  });

  it('keeps the house widths and cites nothing, in every module', async () => {
    const problems: Record<string, unknown[]> = {};

    for (const rel of await treeOf(project.projectDir)) {
      if (!rel.endsWith('.ts') || rel.startsWith('lib/')) continue;

      const source = await readFile(join(project.projectDir, rel), 'utf8');
      const found = [
        ...widthProblems(source, rel),
        ...citationProblems(source, rel),
      ];
      if (found.length > 0) problems[rel] = found;
    }

    expect(problems).toEqual({});
  });

  it('writes every relative import with a .js extension', async () => {
    // `moduleResolution: "bundler"` accepts
    // `'../app/db'` and the app throws
    // ERR_MODULE_NOT_FOUND at boot. Neither the
    // gate above nor a golden would see it.
    const problems: Record<string, string[]> = {};

    for (const rel of await treeOf(project.projectDir)) {
      if (!rel.endsWith('.ts')) continue;

      const source = await readFile(join(project.projectDir, rel), 'utf8');
      const found = relativeSpecifiersEndInJs(source);
      if (found.length > 0) problems[rel] = found;
    }

    expect(problems).toEqual({});
  });

  it('is already formatted the way its own prettier wants', async () => {
    expect(await prettierProblems(await lintFiles())).toEqual([]);
  }, 120_000);

  it('passes its own eslint over everything mBoss wrote', async () => {
    // The code-behind is left out, and only here.
    // It is the user's own code in a real project
    // and it is a fixture in this one, and this
    // fixture deliberately holds a private
    // function nothing calls — which is exactly
    // what `no-unused-vars` is for. mBoss promises
    // that what the scaffold and the compiler
    // write passes the lint they ship; it promises
    // nothing about what somebody writes in `lib/`,
    // and a config that let dead code through
    // there would be the worse answer.
    const files = (await lintFiles()).filter(
      (file) => !file.path.startsWith('lib/'),
    );

    expect(await eslintProblems(files)).toEqual([]);
  }, 120_000);

  it('has written nothing outside the project directory', async () => {
    // Scaffolding, applying and compiling all
    // write, and every one of them takes the
    // directory to write into. A stray absolute
    // path — a lock, a manifest cache, a
    // temporary file left beside a golden —
    // would be invisible to every other
    // assertion here.
    expect(await repoSnapshot()).toEqual(REPO_BEFORE);
  });
});

describe('after a workflow is deleted', () => {
  // Last, because it changes the project the
  // block above is about. Deleting a document is
  // the ordinary way a workflow goes away —
  // renaming one is the same thing twice — and
  // without pruning the generated file it left
  // behind stays in `tsconfig`'s include, gets
  // type-checked against handlers that may have
  // gone with it, and fails in a file the user is
  // told not to edit.
  it('prunes its generated file and leaves the rest compiling', async () => {
    await rm(join(project.mbossDir, 'workflows', 'form_intake.workflow.json'));

    const result = await compileProject(project.projectDir, {
      timezone: TIMEZONE,
    });

    expect(result.ok ? [] : result.failures).toEqual([]);
    expect(result.ok && result.removed).toEqual([
      'src/workflows/form_intake.workflow.ts',
    ]);
    expect(Object.keys(await generatedFiles())).toEqual([
      'approval_flow.workflow.ts',
      'groom_booking.workflow.ts',
      'index.ts',
    ]);

    const registry = await readFile(
      join(project.projectDir, 'src', 'workflows', 'index.ts'),
      'utf8',
    );
    expect(registry).not.toContain('form_intake');
    expect(registry).toContain('groom_booking');

    const checked = typecheckProject(project.projectDir);
    expect(checked.ok ? [] : checked.problems).toEqual([]);
    expect(checked.checkedFiles).not.toContain(
      'src/workflows/form_intake.workflow.ts',
    );
  }, 120_000);
});
