import { describe, expect, it } from 'vitest';

import { eslintProblems, prettierProblems, type LintFile } from './lint.js';

const PRETTIERRC: LintFile = {
  path: '.prettierrc.json',
  contents: '{ "singleQuote": true, "semi": true, "printWidth": 80 }\n',
};

const PRETTIERIGNORE: LintFile = {
  path: '.prettierignore',
  contents: 'node_modules\ncoverage\nsrc/workflows\n',
};

const ESLINT_CONFIG: LintFile = {
  path: 'eslint.config.mjs',
  contents: [
    "import js from '@eslint/js';",
    "import tseslint from 'typescript-eslint';",
    "import prettier from 'eslint-config-prettier';",
    '',
    'export default tseslint.config(',
    "  { ignores: ['node_modules/**', 'coverage/**', 'src/workflows/**'] },",
    '  js.configs.recommended,',
    '  ...tseslint.configs.recommended,',
    '  prettier,',
    ');',
    '',
  ].join('\n'),
};

const CLEAN_COMPOSE: LintFile = {
  path: 'docker-compose.yml',
  contents: ['services:', '  postgres:', '    image: postgres:17', ''].join(
    '\n',
  ),
};

describe('prettierProblems', () => {
  it('reports a mis-indented compose file', async () => {
    const bad: LintFile = {
      path: 'docker-compose.yml',
      contents: ['services:', '      postgres:', '        image: x', ''].join(
        '\n',
      ),
    };

    await expect(prettierProblems([PRETTIERRC, bad])).resolves.toEqual([
      'docker-compose.yml',
    ]);
  });

  it('says nothing about a well-formatted set', async () => {
    const files = [PRETTIERRC, PRETTIERIGNORE, CLEAN_COMPOSE, ESLINT_CONFIG];

    await expect(prettierProblems(files)).resolves.toEqual([]);
  });

  it("reads the emitted .prettierrc.json, not this repo's", async () => {
    // Both this repo's own rc and Prettier's
    // defaults want semicolons, and a throwaway
    // project sits inside this repo — so a runner
    // that missed the emitted rc would report the
    // other file of the two.
    const noSemiRc: LintFile = {
      path: '.prettierrc.json',
      contents: '{ "semi": false, "singleQuote": true }\n',
    };
    const noSemi: LintFile = {
      path: 'src/app/clean.ts',
      contents: "export const value = 'x'\n",
    };
    const withSemi: LintFile = {
      path: 'src/app/dirty.ts',
      contents: "export const value = 'x';\n",
    };

    await expect(
      prettierProblems([noSemiRc, noSemi, withSemi]),
    ).resolves.toEqual(['src/app/dirty.ts']);
  });

  it('honours the emitted .prettierignore', async () => {
    const generated: LintFile = {
      path: 'src/workflows/groom_booking.workflow.ts',
      contents: 'export  const  value   =   "x"\n',
    };

    await expect(
      prettierProblems([PRETTIERRC, PRETTIERIGNORE, generated]),
    ).resolves.toEqual([]);
    await expect(prettierProblems([PRETTIERRC, generated])).resolves.toEqual([
      'src/workflows/groom_booking.workflow.ts',
    ]);
  });

  it('skips a file prettier has no parser for, as --check does', async () => {
    const files: LintFile[] = [
      PRETTIERRC,
      { path: '.env.example', contents: 'PORT=3000\n' },
      { path: 'lib/.gitkeep', contents: '' },
      { path: 'Dockerfile', contents: 'FROM node:24.18.0-slim\n' },
    ];

    await expect(prettierProblems(files)).resolves.toEqual([]);
  });
});

describe('eslintProblems', () => {
  it('reports an unused variable', async () => {
    const bad: LintFile = {
      path: 'src/app/unused.ts',
      contents: ['const unused = 1;', '', 'export const used = 2;', ''].join(
        '\n',
      ),
    };
    const found = await eslintProblems([ESLINT_CONFIG, bad]);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('src/app/unused.ts');
    expect(found[0]).toContain('no-unused-vars');
  });

  it('says nothing about a clean file', async () => {
    const good: LintFile = {
      path: 'src/app/clean.ts',
      contents: 'export const used = 2;\n',
    };

    await expect(eslintProblems([ESLINT_CONFIG, good])).resolves.toEqual([]);
  });

  it('honours the emitted ignores', async () => {
    const generated: LintFile = {
      path: 'src/workflows/gen.ts',
      contents: 'const unused = 1;\n',
    };

    await expect(eslintProblems([ESLINT_CONFIG, generated])).resolves.toEqual(
      [],
    );
  });
});
