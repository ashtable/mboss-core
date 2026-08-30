import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixturesRoot } from '../test-support/fixtures.js';
import { scanLib } from './scan.js';

const brokenDir = join(fixturesRoot, 'lib-broken');

describe('scanLib on code-behind that does not compile', () => {
  it('returns a manifest instead of throwing', () => {
    // Code mid-edit is the ordinary state of a
    // project, and the canvas still has to draw.
    expect(() => scanLib(brokenDir)).not.toThrow();
  });

  it('names the file the type error is in, with a message', () => {
    const errors = scanLib(brokenDir).errors;

    expect(errors.map((error) => error.file)).toEqual(['lib-broken/broken.ts']);
    expect(errors[0]?.message.length).toBeGreaterThan(0);
  });

  it('still reports the functions and types that scanned cleanly', () => {
    const manifest = scanLib(brokenDir);

    expect(manifest.functions.map((fn) => fn.export)).toContain('parseRequest');
    expect(manifest.types).toContain('BookingReq');
    expect(manifest.typeSources['BookingReq']).toBe('lib-broken/types.ts');
  });
});
