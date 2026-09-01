import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { controlProblems } from './test-support/style.js';

/**
 * No source file in this repo carries a control
 * character.
 *
 * The rest of the house style is audited over
 * emitted output only, because eslint and prettier
 * read this repo's own sources already. They do not
 * read this rule. A stray NUL makes git classify a
 * file as binary, so it shows as `Bin` in every
 * diff and grep skips it, while prettier, eslint
 * and tsc all accept it without a word — and a file
 * nobody can read in a review is a file nobody
 * reviewed.
 *
 * The width and citation rules stay scoped to
 * emitted output. Test titles here run long on
 * purpose and prettier cannot break them.
 */

const SRC = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

const FILES = sourceFiles(SRC).map((path) => ({
  path,
  rel: path.slice(SRC.length + 1),
}));

describe('every TypeScript file under src', () => {
  it('is actually being read, so a clean sweep is not an empty one', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.map((file) => file.rel)).toContain('index.ts');
  });

  it('carries no control character', () => {
    const offenders = FILES.flatMap((file) =>
      controlProblems(readFileSync(file.path, 'utf8')).map(
        (problem) => `${file.rel}:${problem.line}: ${problem.why}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});
