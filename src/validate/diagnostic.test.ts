import { describe, expect, it } from 'vitest';

import {
  DiagnosticCodeSchema,
  DiagnosticSchema,
  diagnostic,
} from './diagnostic.js';

describe('the codes the queue rules report', () => {
  it('names both of them, so a tool can match on either', () => {
    expect(DiagnosticCodeSchema.options).toContain('V17');
    expect(DiagnosticCodeSchema.options).toContain('V18');
  });

  it('reports both as errors', () => {
    // Neither is work an author has not got to
    // yet. A partitioned queue with no key never
    // dispatches its items, and limits that
    // disagree stop the app starting at all, so
    // both are things the document says that
    // cannot be true.
    expect(diagnostic('V17', 'partition').severity).toBe('error');
    expect(diagnostic('V18', 'limits').severity).toBe('error');
  });

  it('builds findings a reader of the wire can parse', () => {
    const found = diagnostic('V18', 'limits', { nodeId: 'index_pages' });

    expect(DiagnosticSchema.parse(found)).toEqual(found);
  });
});
