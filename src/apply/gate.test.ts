import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeProject,
  removeProject,
  type TestProject,
} from '../test-support/project.js';

import { applySpec } from './index.js';
import { workflowFile } from './paths.js';
import type { WorkflowSpec } from './proposal.js';

/**
 * What an edit has to pass to reach the disk.
 *
 * The gate is `hasErrors`, not "no diagnostics":
 * half-drawn workflows are saved all day long, and
 * a canvas that refused to save until the document
 * was finished would be unusable.
 */
describe('the validation gate on apply', () => {
  let project: TestProject;

  const twoSteps: WorkflowSpec = {
    nodes: [
      { id: 'find_slot', kind: 'step', title: 'Find slot', config: {} },
      { id: 'book_slot', kind: 'step', title: 'Book slot', config: {} },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'find_slot', port: 'out' },
        to: { node: 'book_slot' },
        back: false,
      },
    ],
  };

  beforeEach(async () => {
    project = await makeProject();
  });

  afterEach(async () => {
    await removeProject(project);
  });

  it('applies a draft whose only findings are warnings', async () => {
    const outcome = await applySpec(project.mbossDir, {
      name: 'booking',
      spec: twoSteps,
      baseRevision: null,
    });

    expect(outcome).toMatchObject({ ok: true, ir: { revision: 1 } });

    const diagnostics = outcome.ok ? outcome.diagnostics : [];
    expect(diagnostics.map((found) => found.code)).toContain('V01');
    expect(diagnostics.every((found) => found.severity === 'warning')).toBe(
      true,
    );
  });

  it('refuses an edit the document could not survive', async () => {
    await applySpec(project.mbossDir, {
      name: 'booking',
      spec: twoSteps,
      baseRevision: null,
    });

    const path = workflowFile(project.mbossDir, 'booking');
    const before = await readFile(path, 'utf8');

    const outcome = await applySpec(project.mbossDir, {
      name: 'booking',
      spec: {
        nodes: [
          { id: 'find_slot', kind: 'step', title: 'One', config: {} },
          { id: 'find_slot', kind: 'step', title: 'Two', config: {} },
        ],
        edges: [],
      },
      baseRevision: 1,
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(!outcome.ok && outcome.error).toMatchObject({
      errors: [{ code: 'V02', severity: 'error' }],
    });

    expect(await readFile(path, 'utf8')).toBe(before);
  });
});
