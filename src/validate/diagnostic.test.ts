import { describe, expect, it } from 'vitest';

import {
  DiagnosticCodeSchema,
  DiagnosticSchema,
  diagnostic,
} from './diagnostic.js';

describe('the latest diagnostic codes', () => {
  it('names them, so a tool can match on any of them', () => {
    expect(DiagnosticCodeSchema.options).toContain('V17');
    expect(DiagnosticCodeSchema.options).toContain('V18');
    expect(DiagnosticCodeSchema.options).toContain('V19');
  });

  it('reports each as an error', () => {
    // Neither is work an author has not got to
    // yet. A partitioned queue with no key never
    // dispatches its items, and limits that
    // disagree stop the app starting at all, so
    // all three are things the document says that
    // cannot be true.
    expect(diagnostic('V17', 'partition').severity).toBe('error');
    expect(diagnostic('V18', 'limits').severity).toBe('error');
    expect(diagnostic('V19', 'payload type').severity).toBe('error');
  });

  it('builds findings a reader of the wire can parse', () => {
    const found = diagnostic('V18', 'limits', { nodeId: 'index_pages' });

    expect(DiagnosticSchema.parse(found)).toEqual(found);
  });
});
