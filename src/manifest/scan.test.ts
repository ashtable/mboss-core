import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  expectGolden,
  fixturesRoot,
} from '../test-support/fixtures.js';
import { scanLib } from './scan.js';
import type { LibFunction, LibManifest } from './types.js';

const manifest = scanLib(join(fixturesRoot, 'lib'));

function exported(name: string): LibFunction {
  const found = manifest.functions.find((fn) => fn.export === name);
  if (!found) throw new Error(`${name} is not in the manifest`);
  return found;
}

function withoutScannedAt(
  scanned: LibManifest,
): Omit<LibManifest, 'scannedAt'> {
  return {
    sourceHash: scanned.sourceHash,
    functions: scanned.functions,
    types: scanned.types,
    typeSources: scanned.typeSources,
    errors: scanned.errors,
  };
}

describe('scanLib', () => {
  it('offers exactly the handlers the code-behind exports', () => {
    expect(manifest.functions.map((fn) => fn.export).sort()).toEqual([
      'bookAppointment',
      'findSlot',
      'parseRequest',
      'recordBooking',
      'twilioChat',
    ]);
  });

  it('skips a test file even though it has a named export', () => {
    expect(manifest.functions.map((fn) => fn.export)).not.toContain(
      'assertParses',
    );
    expect(manifest.functions.map((fn) => fn.file)).not.toContain(
      'lib/helpers.test.ts',
    );
  });

  it('skips a function that is not exported', () => {
    expect(manifest.functions.map((fn) => fn.export)).not.toContain('slotKey');
  });

  it('skips a default export, which no generated import could name', () => {
    expect(manifest.functions.map((fn) => fn.export)).not.toContain('notify');
    expect(manifest.functions.map((fn) => fn.file)).not.toContain(
      'lib/notify.ts',
    );
  });

  it('records where each handler lives, project-relative and posix', () => {
    expect(exported('findSlot').file).toBe('lib/findSlot.ts');
  });

  it('records each parameter by name and written type', () => {
    expect(exported('parseRequest').params).toEqual([
      { name: 'event', type: 'WebhookEvent' },
    ]);
  });

  it('unwraps the Promise an async handler returns', () => {
    expect(exported('findSlot').returnType).toBe('SlotGrid');
  });

  it('leaves a synchronous handler’s return type alone', () => {
    expect(exported('parseRequest').returnType).toBe('BookingReq');
  });

  it('takes the JSDoc summary and leaves the tags out of it', () => {
    const doc = exported('parseRequest').doc;

    expect(doc).toBe(
      'Flattens the incoming webhook into the shape the rest of the ' +
        'workflow reads.',
    );
    expect(doc).not.toContain('@param');
  });

  it('lists exported interfaces and type aliases alike', () => {
    expect(manifest.types).toEqual([
      'Booking',
      'BookingReq',
      'ChatPrompt',
      'ChatReply',
      'SlotGrid',
      'WebhookEvent',
    ]);
  });

  it('says which file each exported type came from', () => {
    // A bare list of names cannot produce
    // `import type { Booking } from …`, which is
    // what the compiler has to emit.
    expect(manifest.typeSources['Booking']).toBe('lib/types.ts');
    expect(manifest.typeSources['ChatReply']).toBe('lib/types.ts');
  });

  it('reports no errors for code that compiles', () => {
    expect(manifest.errors).toEqual([]);
  });

  it('knows the Node globals a handler is written against', () => {
    // `twilioChat` reads its credential out of the
    // environment, which the project's own tsc
    // compiles without complaint. A scan that
    // called that a type error would send whoever
    // reads the manifest off to fix working code.
    const file = exported('twilioChat').file;

    expect(manifest.errors.filter((error) => error.file === file)).toEqual([]);
  });

  it('stamps the scan with an instant, which is why it is not in the golden', () => {
    expect(Number.isNaN(Date.parse(manifest.scannedAt))).toBe(false);
    expect(new Date(manifest.scannedAt).toISOString()).toBe(manifest.scannedAt);
  });

  it('matches the blessed manifest', () => {
    expectGolden(
      'golden/manifest/lib.manifest.json',
      canonicalJson(withoutScannedAt(manifest)),
    );
  });
});
