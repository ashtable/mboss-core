import { describe, expect, it } from 'vitest';

import { sourceHashOf } from './hash.js';

const files = [
  { path: 'lib/findSlot.ts', content: 'export const a = 1;\n' },
  { path: 'lib/types.ts', content: 'export type A = number;\n' },
];

describe('sourceHashOf', () => {
  it('does not depend on the order the files are listed in', () => {
    expect(sourceHashOf([...files].reverse())).toBe(sourceHashOf(files));
  });

  it('changes when one byte of content changes', () => {
    const edited = files.map((file) =>
      file.path === 'lib/findSlot.ts'
        ? { ...file, content: 'export const a = 2;\n' }
        : file,
    );

    expect(sourceHashOf(edited)).not.toBe(sourceHashOf(files));
  });

  it('changes when a file is renamed but its content is not', () => {
    const renamed = files.map((file) =>
      file.path === 'lib/findSlot.ts'
        ? { ...file, path: 'lib/findOpenSlot.ts' }
        : file,
    );

    expect(sourceHashOf(renamed)).not.toBe(sourceHashOf(files));
  });

  it('is stable across calls, so it can be compared to a cached value', () => {
    expect(sourceHashOf(files)).toBe(sourceHashOf(files));
  });
});
