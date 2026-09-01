import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalJson,
  expectGolden,
  fixturesRoot,
  readFixture,
  readFixtureJson,
} from './fixtures.js';

describe('canonicalJson', () => {
  it('sorts keys at every depth, so a reordered object is not a golden diff', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n',
    );
  });

  it('leaves array order alone, because order is meaning there', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[\n  3,\n  1,\n  2\n]\n');
  });

  it('sorts the keys of objects inside arrays', () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe(
      '[\n  {\n    "a": 2,\n    "b": 1\n  }\n]\n',
    );
  });

  it('ends with a newline, so a golden is a well-formed text file', () => {
    expect(canonicalJson({})).toBe('{}\n');
  });

  it('passes null through rather than treating it as an object', () => {
    expect(canonicalJson({ a: null })).toBe('{\n  "a": null\n}\n');
  });
});

describe('the fixture readers', () => {
  it('resolves paths against the fixture root, not the caller', () => {
    expect(readFixture('ir/empty_draft.workflow.json')).toContain(
      '"nodes": []',
    );
  });

  it('parses a JSON fixture', () => {
    const draft = readFixtureJson<{ revision: number }>(
      'ir/empty_draft.workflow.json',
    );

    expect(draft.revision).toBe(1);
  });
});

/**
 * The comparator every golden in this repository
 * goes through — twenty compiled workflows, the
 * scaffolded project, the manifests and the
 * signatures — which makes it the one auditor
 * whose own failure would be silent. A comparison
 * that stopped comparing would report every one of
 * them clean over nothing.
 *
 * The scratch golden is written by the test and
 * removed after it, and its content is constructed
 * here rather than read, so a stray
 * `UPDATE_GOLDENS=1` run cannot bless whatever the
 * code happened to produce into the expectation.
 */
describe('expectGolden', () => {
  const rel = 'golden/self-test/comparator.txt';
  const path = join(fixturesRoot, rel);
  const BLESSED = 'the blessed content\n';
  const PRODUCED = 'what the code produced instead\n';

  beforeEach(() => {
    vi.stubEnv('UPDATE_GOLDENS', '');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, BLESSED, 'utf8');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dirname(path), { recursive: true, force: true });
  });

  it('passes when the actual is what was blessed', () => {
    expect(() => {
      expectGolden(rel, BLESSED);
    }).not.toThrow();
  });

  it('fails when it is not, which is the whole of its job', () => {
    expect(() => {
      expectGolden(rel, PRODUCED);
    }).toThrow();
  });

  it('leaves the blessed file alone when it is not blessing', () => {
    expect(() => {
      expectGolden(rel, PRODUCED);
    }).toThrow();

    expect(readFileSync(path, 'utf8')).toBe(BLESSED);
  });

  describe('with UPDATE_GOLDENS=1', () => {
    beforeEach(() => {
      vi.stubEnv('UPDATE_GOLDENS', '1');
    });

    it('rewrites the golden to what was actually produced', () => {
      try {
        expectGolden(rel, PRODUCED);
      } catch {
        // The throw is the next test's business.
      }

      expect(readFileSync(path, 'utf8')).toBe(PRODUCED);
    });

    it('still throws, so a blessing run is never a passing run', () => {
      // Blessing and passing look identical from
      // the outside otherwise, and a wrong output
      // silently becomes the definition of right.
      expect(() => {
        expectGolden(rel, PRODUCED);
      }).toThrow(/rewrote the golden/);
    });
  });
});
