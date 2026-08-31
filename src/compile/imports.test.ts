import { describe, expect, it } from 'vitest';

import type { LibManifest } from '../manifest/index.js';
import { specifiersOf } from '../test-support/specifiers.js';

import { importBlock, libTypeImport, libValueImport } from './imports.js';
import { UnsupportedIR } from './unsupported.js';

const MANIFEST: LibManifest = {
  scannedAt: '2026-08-31T00:00:00.000Z',
  sourceHash: 'deadbeef',
  functions: [
    {
      export: 'parseRequest',
      file: 'lib/parseRequest.ts',
      params: [{ name: 'event', type: 'WebhookEvent' }],
      returnType: 'BookingReq',
    },
    {
      export: 'findSlot',
      file: 'lib/findSlot.ts',
      params: [{ name: 'req', type: 'BookingReq' }],
      returnType: 'SlotGrid',
    },
  ],
  types: ['BookingReq', 'SlotGrid', 'WebhookEvent'],
  typeSources: {
    BookingReq: 'lib/types.ts',
    SlotGrid: 'lib/types.ts',
    WebhookEvent: 'lib/types.ts',
  },
  nonSerializable: [],
  errors: [],
};

describe('libTypeImport', () => {
  it('reaches the file the manifest says the type came from', () => {
    expect(libTypeImport(MANIFEST, 'SlotGrid')).toEqual({
      specifier: '../../lib/types.js',
      name: 'SlotGrid',
      type: true,
    });
  });

  it('refuses a type the code-behind does not export', () => {
    // A silent broken import is worse than a loud
    // failure: the workflow would compile and then
    // fail to resolve at boot.
    expect(() => libTypeImport(MANIFEST, 'Invoice')).toThrow(UnsupportedIR);
    expect(() => libTypeImport(MANIFEST, 'Invoice')).toThrow(/Invoice/);
  });
});

describe('an aliased binding', () => {
  it('imports the export under the name the file uses', () => {
    // A workflow named after a handler it calls
    // exports that identifier itself, and one file
    // cannot both import and declare it.
    expect(
      importBlock([
        {
          specifier: '../../lib/parseRequest.js',
          name: 'parseRequest',
          alias: 'parseRequestHandler',
          type: false,
        },
      ]),
    ).toBe(
      'import { parseRequest as parseRequestHandler } from ' +
        "'../../lib/parseRequest.js';\n",
    );
  });
});

describe('libValueImport', () => {
  it('reaches the file the handler is exported from', () => {
    expect(libValueImport(MANIFEST, 'parseRequest')).toEqual({
      specifier: '../../lib/parseRequest.js',
      name: 'parseRequest',
      type: false,
    });
  });

  it('refuses a handler the code-behind does not export', () => {
    expect(() => libValueImport(MANIFEST, 'invoice')).toThrow(UnsupportedIR);
  });
});

describe('importBlock', () => {
  it('collects two types from one file into one statement', () => {
    const block = importBlock([
      libTypeImport(MANIFEST, 'SlotGrid'),
      libTypeImport(MANIFEST, 'BookingReq'),
    ]);

    expect(block).toBe(
      "import type { BookingReq, SlotGrid } from '../../lib/types.js';\n",
    );
  });

  it('writes one value statement per source file, by specifier', () => {
    const block = importBlock([
      libValueImport(MANIFEST, 'parseRequest'),
      libValueImport(MANIFEST, 'findSlot'),
    ]);

    expect(block).toBe(
      [
        "import { findSlot } from '../../lib/findSlot.js';",
        "import { parseRequest } from '../../lib/parseRequest.js';",
        '',
      ].join('\n'),
    );
  });

  it('never mixes a type import into a value import', () => {
    // `verbatimModuleSyntax` rejects a mixed
    // statement outright, and this is the single
    // most likely emission bug.
    const block = importBlock([
      { specifier: '../app/db.js', name: 'appDb', type: false },
      { specifier: '../app/db.js', name: 'AppDb', type: true },
    ]);

    expect(block).toBe(
      [
        "import { appDb } from '../app/db.js';",
        "import type { AppDb } from '../app/db.js';",
        '',
      ].join('\n'),
    );
  });

  it('groups builtins, then packages, then relative paths', () => {
    const block = importBlock([
      libValueImport(MANIFEST, 'findSlot'),
      { specifier: '@dbos-inc/dbos-sdk', name: 'DBOS', type: false },
      { specifier: 'node:crypto', name: 'randomUUID', type: false },
      { specifier: '../app/db.js', name: 'appDb', type: false },
    ]);

    expect(block).toBe(
      [
        "import { randomUUID } from 'node:crypto';",
        '',
        "import { DBOS } from '@dbos-inc/dbos-sdk';",
        '',
        "import { findSlot } from '../../lib/findSlot.js';",
        "import { appDb } from '../app/db.js';",
        '',
      ].join('\n'),
    );
  });

  it('never repeats a name that was asked for twice', () => {
    const block = importBlock([
      libTypeImport(MANIFEST, 'SlotGrid'),
      libTypeImport(MANIFEST, 'SlotGrid'),
    ]);

    expect(block).toBe("import type { SlotGrid } from '../../lib/types.js';\n");
  });

  it('is empty when nothing is imported', () => {
    expect(importBlock([])).toBe('');
  });

  it('puts one binding per line when the statement is too wide', () => {
    const block = importBlock([
      { specifier: '../app/contract.js', name: 'EventWait', type: true },
      { specifier: '../app/contract.js', name: 'PayloadCheck', type: true },
      {
        specifier: '../app/contract.js',
        name: 'TriggerDescriptor',
        type: true,
      },
      { specifier: '../app/contract.js', name: 'WaitDescriptor', type: true },
    ]);

    expect(block).toBe(
      [
        'import type {',
        '  EventWait,',
        '  PayloadCheck,',
        '  TriggerDescriptor,',
        '  WaitDescriptor,',
        "} from '../app/contract.js';",
        '',
      ].join('\n'),
    );
  });

  it('writes specifiers node can resolve', () => {
    const block = importBlock([
      libValueImport(MANIFEST, 'findSlot'),
      libTypeImport(MANIFEST, 'SlotGrid'),
      { specifier: '@dbos-inc/dbos-sdk', name: 'DBOS', type: false },
    ]);

    for (const specifier of specifiersOf(block)) {
      if (!specifier.startsWith('.')) continue;
      expect(specifier.endsWith('.js')).toBe(true);
    }
  });
});
