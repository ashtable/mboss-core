import { describe, expect, it } from 'vitest';

import {
  packageOf,
  relativeSpecifiersEndInJs,
  specifiersOf,
} from './specifiers.js';

describe('specifiersOf', () => {
  it('finds every form of import', () => {
    const fixture = [
      "import a from 'static-import';",
      "import type { B } from 'type-only-import';",
      "export * from 'export-star';",
      "const c = await import('dynamic-import');",
      "const d = require('require-call');",
      "const notAnImport = 'this is only a string literal';",
    ].join('\n');

    expect(specifiersOf(fixture).sort()).toEqual([
      'dynamic-import',
      'export-star',
      'require-call',
      'static-import',
      'type-only-import',
    ]);
  });
});

describe('relativeSpecifiersEndInJs', () => {
  it('reports an extensionless relative import', () => {
    expect(relativeSpecifiersEndInJs("import { a } from '../app/db';")).toEqual(
      ['../app/db'],
    );
  });

  it('reports a relative import written with .ts', () => {
    expect(
      relativeSpecifiersEndInJs("import { a } from './contract.ts';"),
    ).toEqual(['./contract.ts']);
  });

  it('reports an extensionless export-from and dynamic import', () => {
    const source = [
      "export * from './index';",
      "const m = await import('./late');",
    ].join('\n');

    expect(relativeSpecifiersEndInJs(source).sort()).toEqual([
      './index',
      './late',
    ]);
  });

  it('accepts relative imports that end in .js', () => {
    const source = [
      "import { appDb } from '../app/db.js';",
      "import * as wf from './groom_booking.workflow.js';",
      "export * from './layout.js';",
    ].join('\n');

    expect(relativeSpecifiersEndInJs(source)).toEqual([]);
  });

  it('ignores bare and node: specifiers, which carry no extension', () => {
    const source = [
      "import { DBOS } from '@dbos-inc/dbos-sdk';",
      "import { join } from 'node:path';",
      "import { defineConfig } from 'prisma/config';",
    ].join('\n');

    expect(relativeSpecifiersEndInJs(source)).toEqual([]);
  });
});

describe('packageOf', () => {
  it('keeps a whole scoped name', () => {
    expect(packageOf('@dbos-inc/dbos-sdk')).toBe('@dbos-inc/dbos-sdk');
    expect(packageOf('@prisma/adapter-pg')).toBe('@prisma/adapter-pg');
  });

  it('strips a subpath but keeps the scope', () => {
    expect(packageOf('prisma/config')).toBe('prisma');
    expect(packageOf('@dbos-inc/dbos-sdk/datasource')).toBe(
      '@dbos-inc/dbos-sdk',
    );
  });

  it('has no package for a relative or node specifier', () => {
    expect(packageOf('./db.js')).toBeNull();
    expect(packageOf('../app/contract.js')).toBeNull();
    expect(packageOf('node:crypto')).toBeNull();
  });
});
