import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { expectGolden } from '../test-support/fixtures.js';
import { expectHouseStyle } from '../test-support/style.js';

import { SCAFFOLD_DIRS, scaffoldFiles } from './files.js';

/**
 * What a new project is made of.
 *
 * `scaffoldFiles` is the deterministic half of the
 * scaffold: it writes nothing and mints nothing,
 * so the whole file set is a pure function of a
 * name and two secrets and can be pinned. It does
 * read — the runtime tree it copies is real source
 * in this repo — and that is a different promise
 * from being filesystem-free.
 */

const OPTIONS = {
  name: 'my_app',
  linkKeys: `k1:${'ab'.repeat(32)}`,
  eventsSecret: 'test-events-secret',
};

const FILES = scaffoldFiles(OPTIONS);
const PATHS = FILES.map((file) => file.path);

function contentsOf(path: string): string {
  const found = FILES.find((file) => file.path === path);
  if (!found) throw new Error(`nothing emitted at ${path}`);

  return found.contents;
}

describe('the emitted tree', () => {
  it('is sorted, so two runs are comparable line by line', () => {
    expect(PATHS).toEqual([...PATHS].sort());
  });

  it('names no path twice', () => {
    expect(new Set(PATHS).size).toBe(PATHS.length);
  });

  it('writes every path project-relative, in posix', () => {
    for (const path of [...PATHS, ...SCAFFOLD_DIRS]) {
      expect(path).not.toContain('\\');
      expect(path.startsWith('/')).toBe(false);
      expect(path).not.toContain('..');
    }
  });

  it('carries the layout a project is documented to have', () => {
    // Every entry the on-disk layout fixes, by
    // the path it fixes it at. A rename here is a
    // rename users read about somewhere else.
    for (const path of [
      '.mboss/workflows/.gitkeep',
      '.mboss/conventions.md',
      '.mcp.json',
      'lib/.gitkeep',
      'src/workflows/index.ts',
      'prisma/schema.prisma',
      'docker-compose.yml',
      'Dockerfile',
      '.env',
      '.env.example',
      'mboss.config.ts',
      'package.json',
    ]) {
      expect(PATHS).toContain(path);
    }

    for (const dir of [
      '.mboss/proposals',
      '.mboss/history',
      '.mboss/skills/mboss',
      '.claude/skills/mboss',
    ]) {
      expect(SCAFFOLD_DIRS).toContain(dir);
    }
  });

  it('creates none of the three derived control files', () => {
    // All three are derived, and an empty one is
    // worse than none: a manifest that fails to
    // parse only makes the next scan redo itself,
    // and a lock file nobody holds has to be
    // decided stale before anyone can write.
    for (const path of [
      '.mboss/manifest.json',
      '.mboss/state.json',
      '.mboss/.lock',
    ]) {
      expect(PATHS).not.toContain(path);
    }
  });

  it('keeps exactly two directories alive with a .gitkeep', () => {
    expect(PATHS.filter((path) => path.endsWith('.gitkeep'))).toEqual([
      '.mboss/workflows/.gitkeep',
      'lib/.gitkeep',
    ]);
  });

  it('marks the entrypoint executable and nothing else', () => {
    const executable = FILES.filter((file) => file.mode !== undefined);

    expect(executable.map((file) => file.path)).toEqual([
      'docker-entrypoint.sh',
    ]);
    expect(executable[0]?.mode).toBe(0o755);
  });
});

describe('every emitted file', () => {
  it.each(FILES.map((file) => file.path))(
    '%s keeps the house style',
    (path) => {
      expectHouseStyle(contentsOf(path), path);
    },
  );

  it.each(FILES.map((file) => file.path))('%s ends in a newline', (path) => {
    const contents = contentsOf(path);

    expect(contents === '' || contents.endsWith('\n')).toBe(true);
  });
});

describe('the copied runtime', () => {
  const ROOT = join(import.meta.dirname, 'app');

  it('is byte-identical to the source this repo type-checks', () => {
    const copied = PATHS.filter((path) => path.startsWith('src/app/'));

    expect(copied.length).toBeGreaterThan(0);
    for (const path of copied) {
      if (path.endsWith('.test.ts')) continue;
      const source = readFileSync(join(ROOT, path.slice('src/app/'.length)));

      expect(contentsOf(path)).toBe(source.toString('utf8'));
    }
  });

  it('copies the registry seed as it stands', () => {
    const seed = readFileSync(join(import.meta.dirname, 'workflows/index.ts'));

    expect(contentsOf('src/workflows/index.ts')).toBe(seed.toString('utf8'));
  });

  it('copies no test file and no snapshot out of the runtime tree', () => {
    // The mirror excludes tests on purpose — a
    // test imports vitest, which the runtime has
    // no business carrying — and the tree still
    // has to hold one, because `vitest run` with
    // no test files exits non-zero. The example
    // below is emitted from a template instead,
    // which satisfies both.
    const others = readdirSync(ROOT).filter(
      (name) => name.endsWith('.test.ts') && name !== 'health.test.ts',
    );

    expect(others.length).toBeGreaterThan(0);
    for (const name of others) {
      expect(PATHS).not.toContain(`src/app/${name}`);
    }

    const emitted = PATHS.filter((path) => path.endsWith('.test.ts'));

    expect(emitted).toEqual(['src/app/health.test.ts']);
  });

  it('emits the example test with the bytes this repo runs', () => {
    const own = readFileSync(join(ROOT, 'health.test.ts'), 'utf8');

    expect(contentsOf('src/app/health.test.ts')).toBe(own);
  });
});

describe('the same options twice', () => {
  it('produce byte-identical output', () => {
    expect(scaffoldFiles(OPTIONS)).toEqual(FILES);
  });

  it('write nothing to the working directory', () => {
    const previous = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), 'scaffold-pure-'));

    try {
      process.chdir(scratch);
      scaffoldFiles(OPTIONS);

      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      process.chdir(previous);
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('the MCP bundle slot', () => {
  it('explains itself when no bundle was supplied', () => {
    expect(PATHS).toContain('.mboss/mcp/README.md');
    expect(PATHS).not.toContain('.mboss/mcp/server.js');
    expect(contentsOf('.mboss/mcp/README.md')).toContain('VS Code extension');
  });

  it('carries the bundle and its version when one was', () => {
    const withBundle = scaffoldFiles({
      ...OPTIONS,
      mcpBundle: { server: 'console.log(1);\n', version: '0.4.2' },
    }).map((file) => file.path);

    expect(withBundle).toContain('.mboss/mcp/server.js');
    expect(withBundle).toContain('.mboss/mcp/VERSION');
    expect(withBundle).not.toContain('.mboss/mcp/README.md');
  });
});

describe('with no secrets supplied', () => {
  it('falls back to the placeholders the example file carries', () => {
    // `scaffoldProject` always supplies minted
    // ones. This path exists so the function is
    // total, and it is the path a caller reaching
    // for `scaffoldFiles` directly takes.
    const bare = scaffoldFiles({ name: 'my_app' });
    const env = bare.find((file) => file.path === '.env');
    const example = bare.find((file) => file.path === '.env.example');

    expect(env?.contents).toBe(example?.contents);
  });
});

describe('the files that carry the project name', () => {
  it('name it in package.json, compose and the config', () => {
    expect(JSON.parse(contentsOf('package.json')).name).toBe('my_app');
    expect(contentsOf('docker-compose.yml')).toContain('name: my_app');
    expect(contentsOf('mboss.config.ts')).toContain("name: 'my_app'");
    expect(contentsOf('README.md')).toContain('# my_app');
  });

  it('refuses a name that could not be a directory or a package', () => {
    expect(() => scaffoldFiles({ ...OPTIONS, name: '../evil' })).toThrow();
    expect(() => scaffoldFiles({ ...OPTIONS, name: 'My App' })).toThrow();
  });

  it('takes an ordinary hyphenated name', () => {
    const named = scaffoldFiles({ ...OPTIONS, name: 'my-app' });
    const pkg = named.find((file) => file.path === 'package.json');

    expect(JSON.parse(pkg?.contents ?? '{}').name).toBe('my-app');
  });
});

describe('the settings a project shares with mBoss', () => {
  const CORE = join(import.meta.dirname, '../..');

  it('type-checks generated code under this repo s own options', () => {
    const emitted = JSON.parse(contentsOf('tsconfig.json'));
    const own = JSON.parse(readFileSync(join(CORE, 'tsconfig.json'), 'utf8'));

    expect(emitted.compilerOptions).toEqual(own.compilerOptions);
    expect(emitted.include).toContain('src');
    expect(emitted.include).toContain('lib');
  });

  it('reaches the database the way this repo does', () => {
    const own = readFileSync(join(CORE, 'prisma.config.ts'), 'utf8');

    expect(contentsOf('prisma.config.ts')).toBe(own);
  });
});

describe('the example test the project ships', () => {
  it('is somewhere the emitted vitest config looks', () => {
    // `vitest run` with no test files at all exits
    // non-zero, so a project that shipped none
    // would fail `npm test` on the day it was
    // created.
    expect(contentsOf('vitest.config.ts')).toContain("'src/**/*.test.ts'");
    expect(PATHS).toContain('src/app/health.test.ts');
  });
});

describe('the CI workflow', () => {
  it('runs the four steps that matter, on pull requests', () => {
    const ci = contentsOf('.github/workflows/ci.yml');
    const order = [
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'run: npm ci',
      'run: npm run lint',
      'run: npm test',
    ].map((step) => ci.indexOf(step));

    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(ci).toContain('on: [pull_request]');
  });
});

/**
 * Which files are pinned by a golden here.
 *
 * The copied runtime is not: it is byte-compared
 * against the source above, and a second copy
 * under `fixtures/` would only be a third place to
 * update. Everything a template produced is.
 */
function isMirrored(path: string): boolean {
  if (path === 'src/workflows/index.ts') return true;

  return path.startsWith('src/app/') && path !== 'src/app/health.test.ts';
}

const TEMPLATED = FILES.filter((file) => !isMirrored(file.path));

/**
 * Where one file's golden lives.
 *
 * The `.golden` suffix is not decoration. A file
 * actually named `.gitignore`, checked in under
 * `fixtures/`, is an ignore file — git would read
 * it and hide `.env` and every other golden beside
 * it, and the suite would go green over a
 * directory that had quietly emptied itself.
 */
function goldenFor(path: string): string {
  return `golden/scaffold/project/${path}.golden`;
}

/**
 * The tree, as one sorted listing: a directory
 * with a trailing slash, a file by its path, and
 * the entrypoint with the mode it is written at.
 */
function treeListing(): string {
  const rows = [
    ...SCAFFOLD_DIRS.map((dir) => ({ key: `${dir}/`, line: `${dir}/` })),
    ...FILES.map((file) => ({
      key: file.path,
      line:
        file.mode === undefined
          ? file.path
          : `${file.path} (${file.mode.toString(8).padStart(4, '0')})`,
    })),
  ].sort((a, b) => (a.key < b.key ? -1 : 1));

  return `${rows.map((row) => row.line).join('\n')}\n`;
}

describe('the blessed tree', () => {
  it('is the listing a project is created with', () => {
    expectGolden('golden/scaffold/tree.txt', treeListing());
  });
});

describe('every templated file', () => {
  it('is a real set, so a clean pass is not an empty one', () => {
    expect(TEMPLATED.length).toBeGreaterThan(20);
  });

  it.each(TEMPLATED.map((file) => file.path))(
    '%s is byte-identical to its golden',
    (path) => {
      // The last assertion about each file, never
      // the first: everything above already
      // checked what a reviewer decided must not
      // change silently. This locks the rest.
      expectGolden(goldenFor(path), contentsOf(path));
    },
  );
});

afterAll(() => {
  // `it.each` above names every emitted path, so a
  // suite that emitted nothing would report clean.
  expect(FILES.length).toBeGreaterThan(20);
});
