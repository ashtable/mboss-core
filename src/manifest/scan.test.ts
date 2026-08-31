import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const unserializable = scanLib(join(fixturesRoot, 'lib-unserializable'));

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
    nonSerializable: scanned.nonSerializable,
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

  it('finds nothing in the fixture code-behind that cannot travel', () => {
    expect(manifest.nonSerializable).toEqual([]);
  });

  it('matches the blessed manifest', () => {
    expectGolden(
      'golden/manifest/lib.manifest.json',
      canonicalJson(withoutScannedAt(manifest)),
    );
  });
});

describe('scanLib on code-behind that cannot travel between blocks', () => {
  it('offers an exported class as a type a node can declare', () => {
    // Without this, a class instance could never
    // be a node's declared input or output, and
    // the rule about class instances would be
    // about a state no document could reach.
    expect(unserializable.types).toContain('Session');
    expect(unserializable.typeSources['Session']).toBe(
      'lib-unserializable/types.ts',
    );
  });

  it('compiles cleanly, so a finding is about meaning not error', () => {
    expect(unserializable.errors).toEqual([]);
  });

  it('names the member at fault for each reason a type can fail', () => {
    expect(unserializable.nonSerializable).toEqual([
      { type: 'Conn', path: 'socket', reason: 'handle' },
      { type: 'Feed', path: 'stream', reason: 'stream' },
      { type: 'Job', path: 'payload.onDone', reason: 'function' },
      { type: 'Session', path: '', reason: 'class' },
      { type: 'Ticket', path: 'onDone', reason: 'function' },
      { type: 'Upload', path: 'body', reason: 'buffer' },
    ]);
  });

  it('matches the blessed manifest', () => {
    expectGolden(
      'golden/manifest/lib-unserializable.manifest.json',
      canonicalJson(withoutScannedAt(unserializable)),
    );
  });

  it('orders findings by type and then by member', () => {
    // Both halves matter, and neither follows the
    // source: the manifest is a blessed artifact,
    // so two scans of the same code have to agree
    // whatever order the checker hands members
    // back in.
    const source = [
      'export interface Beta { z: () => void; a: Buffer }',
      'export interface Alpha { m: Buffer }',
    ].join('\n');

    expect(scannedFromSource(source).nonSerializable).toEqual([
      { type: 'Alpha', path: 'm', reason: 'buffer' },
      { type: 'Beta', path: 'a', reason: 'buffer' },
      { type: 'Beta', path: 'z', reason: 'function' },
    ]);
  });
});

/**
 * A scan of one throwaway code-behind file.
 *
 * The two blessed fixtures are the shapes worth
 * keeping on disk to look at; a sample that exists
 * only to pin an ordering is not one of them.
 */
function scannedFromSource(source: string): LibManifest {
  const projectDir = mkdtempSync(join(tmpdir(), 'mboss-'));

  try {
    mkdirSync(join(projectDir, 'lib'));
    writeFileSync(join(projectDir, 'lib', 'types.ts'), source);

    return scanLib(join(projectDir, 'lib'));
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}
