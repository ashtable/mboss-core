import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  compileProject,
  typecheckProject,
  type CompileProjectResult,
} from '../compile/index.js';
import { scaffoldProject } from '../scaffold/index.js';
import { eslintProblems, prettierProblems } from '../test-support/lint.js';
import { repoSnapshot, treeOf } from '../test-support/tree.js';
import {
  makeTypecheckProject,
  removeTypecheckProject,
  type TypecheckProject,
} from '../test-support/typecheck.js';

import { listPatterns, usePattern } from './index.js';
import type { UsePatternOutcome, WorkflowPattern } from './types.js';

/**
 * Every pattern, from the gallery into a real
 * project on disk.
 *
 * `library.test.ts` holds each one to the
 * compiler's own opinion of it: it validates, it
 * compiles, the emitted file passes the audits.
 * All of that is text compared against text.
 * Nobody has yet asked whether pressing Use leaves
 * a project that builds — and that is the whole
 * offer the gallery makes, and the only part of it
 * a person would notice failing.
 *
 * So each pattern gets a project of its own here:
 * scaffolded, used, compiled, type-checked, and
 * linted with the configuration the project itself
 * ships. It runs hermetically — no network, no
 * database, no container — with the temp project
 * created inside this repository so every package
 * a generated project imports resolves upward out
 * of the packages already installed here.
 */

const TIMEZONE = 'America/Los_Angeles';

/** The name every project here is created under.
 *  Nothing turns on it; a pattern is offered to
 *  whatever project it lands in. */
const PROJECT_NAME = 'pattern_app';

const PATTERNS = listPatterns();

/**
 * The one file here that is nobody's authored
 * work: the cache of the scan of `lib/`. The
 * scaffold deliberately does not create it, and it
 * appears because the handlers a pattern wrote
 * were read.
 */
const MANIFEST_CACHE = '.mboss/manifest.json';

/** Every file in the project, by path and bytes. */
async function filesOf(dir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};

  for (const rel of await treeOf(dir)) {
    found[rel] = await readFile(join(dir, rel), 'utf8');
  }

  return found;
}

/**
 * The project as the two lint runners want it: a
 * path and its bytes.
 *
 * The whole project rather than only the handlers
 * the pattern wrote. Both runners load the
 * project's own configuration out of the set they
 * are given — ESLint imports `eslint.config.mjs`,
 * Prettier reads `.prettierignore` beside the file
 * — so a set holding `lib/` alone would be checked
 * under defaults nobody ships. What that costs is
 * nothing: this is what the project's own
 * `npm run lint` covers.
 */
function lintFiles(files: Record<string, string>): {
  path: string;
  contents: string;
}[] {
  return Object.entries(files).map(([path, contents]) => ({ path, contents }));
}

let REPO_BEFORE: Record<string, string>;

beforeAll(async () => {
  REPO_BEFORE = await repoSnapshot();
});

describe.each(PATTERNS.map((pattern) => [pattern.name, pattern] as const))(
  'the %s pattern, used in a project of its own',
  (name, pattern: WorkflowPattern) => {
    let project: TypecheckProject;
    let scaffolded: Record<string, string>;
    let outcome: UsePatternOutcome;
    let compiled: CompileProjectResult;
    let after: Record<string, string>;

    beforeAll(async () => {
      project = await makeTypecheckProject();

      await scaffoldProject(project.projectDir, { name: PROJECT_NAME });
      scaffolded = await filesOf(project.projectDir);

      outcome = await usePattern(project.projectDir, { pattern, name });
      compiled = await compileProject(project.projectDir, {
        timezone: TIMEZONE,
      });
      after = await filesOf(project.projectDir);
    }, 180_000);

    afterAll(async () => {
      if (project) await removeTypecheckProject(project);
    });

    it('goes in without a refusal', () => {
      // The refusal is what is compared against, so
      // a failure here reads as the code and the
      // path it named rather than as `false`.
      expect(outcome.ok ? [] : [outcome]).toEqual([]);
      expect(outcome.ok && outcome.written).toEqual(
        pattern.lib.map((file) => join(project.projectDir, file.path)),
      );
    });

    it('compiles, along with everything the scaffold left', () => {
      expect(compiled.ok ? [] : compiled.failures).toEqual([]);
      expect(compiled.ok && compiled.written).toEqual(
        [`src/workflows/${name}.workflow.ts`, 'src/workflows/index.ts'].sort(),
      );
      expect(compiled.ok && compiled.removed).toEqual([]);
    });

    it('type-checks, over the files the pattern brought with it', () => {
      const result = typecheckProject(project.projectDir);

      // The problems are printed rather than
      // summarised: "type errors" would send a
      // reader back to run this by hand, and the
      // point of the gate is that it says what is
      // wrong.
      expect(result.ok ? [] : result.problems).toEqual([]);

      // Every handler the pattern shipped and the
      // file compiled from its drawing. A gate that
      // reported clean over an empty program is the
      // one failure mode it could not survive.
      for (const path of [
        ...pattern.lib.map((file) => file.path),
        `src/workflows/${name}.workflow.ts`,
      ]) {
        expect(result.checkedFiles).toContain(path);
      }
    }, 120_000);

    it('is already formatted the way its own prettier wants', async () => {
      expect(await prettierProblems(lintFiles(after))).toEqual([]);
    }, 120_000);

    it('passes its own eslint, handlers included', async () => {
      // Unlike the fixture code-behind the
      // compiler's own integration test leaves out,
      // these handlers are mBoss's to answer for:
      // they ship in the gallery, and a project
      // created from one has to pass the lint it
      // was created with on the first day.
      const files = lintFiles(after);

      expect(files.some((file) => file.path.startsWith('lib/'))).toBe(true);
      expect(await eslintProblems(files)).toEqual([]);
    }, 120_000);

    it('adds its own files and rewrites only the registry', () => {
      // What using a pattern is allowed to do to a
      // project: leave the handlers it ships, the
      // document it drew, the code compiled from
      // that document, and a cache of the scan of
      // the handlers. The registry is the one file
      // already there that is rewritten, because it
      // names every workflow and there is now one
      // more.
      const added = Object.keys(after).filter((path) => !(path in scaffolded));
      const changed = Object.keys(after).filter(
        (path) => path in scaffolded && after[path] !== scaffolded[path],
      );
      const removed = Object.keys(scaffolded).filter(
        (path) => !(path in after),
      );

      expect(added).toEqual(
        [
          ...pattern.lib.map((file) => file.path),
          `.mboss/workflows/${name}.workflow.json`,
          `src/workflows/${name}.workflow.ts`,
          MANIFEST_CACHE,
        ].sort(),
      );
      expect(changed).toEqual(['src/workflows/index.ts']);
      expect(removed).toEqual([]);
    });
  },
);

describe('the whole sweep', () => {
  it('has written nothing outside the projects it made', async () => {
    // Scaffolding, using and compiling all write,
    // and every one of them takes the directory to
    // write into. A stray absolute path — a lock,
    // a manifest cache, a temporary file left
    // beside a golden — would be invisible to
    // every other assertion here.
    expect(await repoSnapshot()).toEqual(REPO_BEFORE);
  });
});
