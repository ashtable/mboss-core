import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeProject,
  removeProject,
  type TestProject,
} from '../test-support/project.js';

import { applySpec, readWorkflow, undo } from './index.js';
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

/**
 * Where a person put a block outlives every write.
 *
 * An agent writes the whole workflow and never
 * writes a coordinate — it is told there are none
 * to write — so a write copies the positions the
 * document already had onto whatever it is given.
 * Otherwise the first edit after somebody arranged
 * a canvas would throw the arrangement away.
 */
describe('positions through a write', () => {
  let project: TestProject;

  const wire = {
    id: 'e1',
    from: { node: 'find_slot', port: 'out' },
    to: { node: 'book_slot' },
    back: false,
  };

  /** What an agent writes: no coordinates in it. */
  const bare = (title: string): WorkflowSpec => ({
    title,
    nodes: [
      { id: 'find_slot', kind: 'step', title: 'Find slot', config: {} },
      { id: 'book_slot', kind: 'step', title: 'Book slot', config: {} },
    ],
    edges: [wire],
  });

  /** What the canvas writes when somebody drags:
   *  every block placed at once. */
  const placed: WorkflowSpec = {
    title: 'Booking',
    nodes: [
      {
        id: 'find_slot',
        kind: 'step',
        title: 'Find slot',
        config: {},
        position: { x: 120, y: 80 },
      },
      {
        id: 'book_slot',
        kind: 'step',
        title: 'Book slot',
        config: {},
        position: { x: 120, y: 212 },
      },
    ],
    edges: [wire],
  };

  const layout = [
    { id: 'find_slot', position: { x: 120, y: 80 } },
    { id: 'book_slot', position: { x: 120, y: 212 } },
  ];

  beforeEach(async () => {
    project = await makeProject();
  });

  afterEach(async () => {
    await removeProject(project);
  });

  it('keeps the positions a spec says nothing about', async () => {
    await applySpec(project.mbossDir, {
      name: 'booking',
      spec: placed,
      baseRevision: null,
    });

    const outcome = await applySpec(project.mbossDir, {
      name: 'booking',
      spec: bare('Renamed'),
      baseRevision: 1,
    });

    expect(outcome).toMatchObject({
      ok: true,
      ir: { revision: 2, title: 'Renamed', nodes: layout },
    });
    expect(await readWorkflow(project.mbossDir, 'booking')).toMatchObject({
      ok: true,
      ir: { nodes: layout },
    });
  });

  /**
   * An undo restores what the workflow said, not
   * where its blocks sit: the snapshot here was
   * taken before anybody had placed anything, and
   * the layout on the canvas is still the layout
   * afterwards.
   */
  it('gives back the earlier document in the current layout', async () => {
    await applySpec(project.mbossDir, {
      name: 'booking',
      spec: bare('First'),
      baseRevision: null,
    });
    await applySpec(project.mbossDir, {
      name: 'booking',
      spec: placed,
      baseRevision: 1,
    });

    expect(await undo(project.mbossDir, 'booking')).toMatchObject({
      ok: true,
      ir: { revision: 3, title: 'First', nodes: layout },
    });
  });
});
