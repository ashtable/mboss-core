import { describe, expect, it } from 'vitest';

import { canonicalJson, readFixture, readFixtureJson } from './fixtures.js';

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
