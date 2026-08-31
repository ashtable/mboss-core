import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { placementProblems } from '../compile/audit.js';
import { relativeSpecifiersEndInJs } from '../test-support/specifiers.js';
import { expectHouseStyle } from '../test-support/style.js';

/**
 * The house style rules, over the runtime tree
 * this repo ships into every generated project.
 *
 * These files are copied verbatim, so what is
 * checked here is checked in every project made
 * from them. `tsc`, eslint and prettier already
 * read them — none of the three has an opinion
 * about comment width, a design-doc citation, or a
 * relative import Node will refuse to resolve.
 *
 * The compiler's own audit is run over them too,
 * in the half of it that applies: the runtime is
 * not a workflow body, so it reads the clock and
 * mints links quite properly, but the placement
 * rules hold here exactly as they do in generated
 * code and nothing else checks them.
 */

const ROOT = import.meta.dirname;

/** Every file that is copied, and no test file. */
function copiedFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return name === '__snapshots__' ? [] : copiedFiles(path);
    }
    return name.endsWith('.test.ts') ? [] : [path];
  });
}

const FILES = ['app', 'workflows'].flatMap((dir) =>
  copiedFiles(join(ROOT, dir)).map((path) => ({
    path,
    rel: path.slice(ROOT.length + 1),
  })),
);

describe('the copied runtime tree', () => {
  it('has files in it, so a clean result is not an empty one', () => {
    expect(FILES.length).toBeGreaterThan(0);
    expect(FILES.map((f) => f.rel)).toContain('app/contract.ts');
    expect(FILES.map((f) => f.rel)).toContain('workflows/index.ts');
  });

  it.each(FILES)('$rel keeps the house widths and cites nothing', (file) => {
    expectHouseStyle(readFileSync(file.path, 'utf8'), file.rel);
  });

  it.each(FILES)('$rel writes every relative import with .js', (file) => {
    const source = readFileSync(file.path, 'utf8');

    expect(relativeSpecifiersEndInJs(source)).toEqual([]);
  });

  it.each(FILES)('$rel puts every call where it can run', (file) => {
    expect(placementProblems(readFileSync(file.path, 'utf8'))).toEqual([]);
  });
});
