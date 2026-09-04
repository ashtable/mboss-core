import { describe, expect, it } from 'vitest';

import { NODE_PALETTE } from '../ir/index.js';

import {
  NODE_HEIGHT,
  NODE_WIDTH,
  TITLE_MAX_CHARS,
  nodeSize,
  truncateTitle,
} from './metrics.js';

describe('nodeSize', () => {
  it('gives every kind the same box', () => {
    for (const entry of NODE_PALETTE) {
      expect(nodeSize(entry.kind)).toEqual({
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }
  });

  it('sizes every kind the palette offers', () => {
    for (const entry of NODE_PALETTE) {
      const { width, height } = nodeSize(entry.kind);

      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    }
  });
});

describe('truncateTitle', () => {
  it('leaves a short title untouched', () => {
    expect(truncateTitle('Find open slot')).toBe('Find open slot');
  });

  it('cuts a long title to the fixed length', () => {
    const long = 'x'.repeat(TITLE_MAX_CHARS + 20);

    expect([...truncateTitle(long)]).toHaveLength(TITLE_MAX_CHARS);
  });

  it('leaves a title of exactly the fixed length untouched', () => {
    const exact = 'x'.repeat(TITLE_MAX_CHARS);

    expect(truncateTitle(exact)).toBe(exact);
  });

  it('cuts on whole characters, so an emoji is never split in half', () => {
    const emoji = '🐕'.repeat(TITLE_MAX_CHARS);

    expect(truncateTitle(emoji)).not.toContain('�');
    expect([...truncateTitle(emoji)]).toHaveLength(TITLE_MAX_CHARS);
  });
});
