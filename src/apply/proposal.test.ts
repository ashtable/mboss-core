import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeProject,
  removeProject,
  type TestProject,
} from '../test-support/project.js';

import {
  applyProposal,
  applySpec,
  proposeSpec,
  readProposal,
  readWorkflow,
  type ProposeOutcome,
} from './index.js';
import { workflowFile } from './paths.js';
import type { WorkflowSpec } from './proposal.js';

const idOf = (outcome: ProposeOutcome): string => {
  if (!outcome.ok)
    throw new Error(`expected a proposal: ${outcome.error.code}`);

  return outcome.proposal.id;
};

/**
 * A proposal is how a headless agent shows its
 * work before anything is committed: it writes a
 * file the canvas can draw as a preview, and the
 * workflow itself is untouched until a person
 * approves.
 */
describe('proposals', () => {
  let project: TestProject;

  const spec = (title: string): WorkflowSpec => ({
    title,
    nodes: [{ id: 'find_slot', kind: 'step', title: 'Find slot', config: {} }],
    edges: [],
  });

  const propose = (title: string): Promise<ProposeOutcome> =>
    proposeSpec(project.mbossDir, {
      name: 'booking',
      spec: spec(title),
      baseRevision: 1,
      proposedBy: 'claude code',
    });

  beforeEach(async () => {
    project = await makeProject();

    await applySpec(project.mbossDir, {
      name: 'booking',
      spec: { title: 'Booking', nodes: [], edges: [] },
      baseRevision: null,
    });
  });

  afterEach(async () => {
    await removeProject(project);
  });

  it('writes a proposal without touching the workflow', async () => {
    const path = workflowFile(project.mbossDir, 'booking');
    const before = await readFile(path, 'utf8');

    const outcome = await propose('Proposed');

    expect(outcome).toMatchObject({
      ok: true,
      proposal: {
        workflow: 'booking',
        baseRevision: 1,
        status: 'proposed',
        proposedBy: 'claude code',
        summary: { nodesAdded: 1, nodesChanged: 0 },
      },
    });

    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('discards the earlier proposal when a newer one arrives', async () => {
    const first = idOf(await propose('First'));
    const second = idOf(await propose('Second'));

    expect(await readProposal(project.mbossDir, first)).toMatchObject({
      status: 'discarded',
    });
    expect(await readProposal(project.mbossDir, second)).toMatchObject({
      status: 'proposed',
    });
  });

  it('leaves other workflows proposals alone', async () => {
    await applySpec(project.mbossDir, {
      name: 'refunds',
      spec: { nodes: [], edges: [] },
      baseRevision: null,
    });

    const other = idOf(
      await proposeSpec(project.mbossDir, {
        name: 'refunds',
        spec: spec('Refunds'),
        baseRevision: 1,
        proposedBy: 'claude code',
      }),
    );

    await propose('Booking');

    expect(await readProposal(project.mbossDir, other)).toMatchObject({
      status: 'proposed',
    });
  });

  /**
   * A spec is agent-authored JSON crossing the MCP
   * boundary, so the name it carries is not a name
   * a person approved. Were the spec's own name to
   * win, approving "an edit to booking" would edit
   * whatever workflow the spec happened to name.
   */
  it('proposes against the workflow it was asked for, not the one the spec names', async () => {
    await applySpec(project.mbossDir, {
      name: 'payments',
      spec: { title: 'Payments', nodes: [], edges: [] },
      baseRevision: null,
    });

    const payments = await readWorkflow(project.mbossDir, 'payments');
    if (!payments.ok) throw new Error('the workflow was not written');

    const outcome = await proposeSpec(project.mbossDir, {
      name: 'booking',
      spec: { ...payments.ir, title: 'Proposed' },
      baseRevision: 1,
      proposedBy: 'claude code',
    });

    expect(outcome).toMatchObject({
      ok: true,
      proposal: { workflow: 'booking' },
    });

    await applyProposal(project.mbossDir, idOf(outcome));

    expect(await readWorkflow(project.mbossDir, 'payments')).toMatchObject({
      ok: true,
      ir: { revision: 1, title: 'Payments' },
    });
  });

  it('marks a proposal applied once it lands', async () => {
    const id = idOf(await propose('Proposed'));

    const applied = await applyProposal(project.mbossDir, id);

    expect(applied).toMatchObject({
      ok: true,
      ir: { revision: 2, title: 'Proposed' },
      summary: { nodesAdded: 1 },
    });
    expect(await readProposal(project.mbossDir, id)).toMatchObject({
      status: 'applied',
    });
  });

  /**
   * Applying twice is the shape a retry takes when
   * an agent did not see the first answer, so the
   * second attempt has to be refused rather than
   * silently raising the revision again.
   */
  it('refuses a proposal that has already been applied', async () => {
    const id = idOf(await propose('Proposed'));
    await applyProposal(project.mbossDir, id);

    expect(await applyProposal(project.mbossDir, id)).toMatchObject({
      ok: false,
      error: { code: 'PROPOSAL_NOT_FOUND', id },
    });
  });

  it('refuses a proposal that was superseded', async () => {
    const first = idOf(await propose('First'));
    await propose('Second');

    expect(await applyProposal(project.mbossDir, first)).toMatchObject({
      ok: false,
      error: { code: 'PROPOSAL_NOT_FOUND', id: first },
    });
  });

  it('refuses an id no proposal ever had', async () => {
    expect(
      await applyProposal(project.mbossDir, 'prop_1700000000000_abcdef01'),
    ).toMatchObject({
      ok: false,
      error: { code: 'PROPOSAL_NOT_FOUND' },
    });
  });

  it('refuses an id that is not one this module mints', async () => {
    expect(await applyProposal(project.mbossDir, '../escape')).toMatchObject({
      ok: false,
      error: { code: 'PROPOSAL_NOT_FOUND' },
    });
  });

  it('refuses to propose against a revision the file has left behind', async () => {
    await applySpec(project.mbossDir, {
      name: 'booking',
      spec: { title: 'Moved on', nodes: [], edges: [] },
      baseRevision: 1,
    });

    expect(await propose('Stale')).toMatchObject({
      ok: false,
      error: { code: 'REVISION_CONFLICT', expected: 1, actual: 2 },
    });
  });

  it('refuses to propose a spec the document could not survive', async () => {
    const outcome = await proposeSpec(project.mbossDir, {
      name: 'booking',
      spec: {
        nodes: [
          { id: 'find_slot', kind: 'step', title: 'One', config: {} },
          { id: 'find_slot', kind: 'step', title: 'Two', config: {} },
        ],
        edges: [],
      },
      baseRevision: 1,
      proposedBy: 'claude code',
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});

/**
 * An agent proposing an edit to a canvas somebody
 * has arranged writes back the blocks it read,
 * with no coordinates on them — it is never shown
 * any. The proposal is filed as it was written,
 * and the layout is collected on the way to disk.
 */
describe('proposals over a placed document', () => {
  let project: TestProject;

  const wire = {
    id: 'e1',
    from: { node: 'find_slot', port: 'out' },
    to: { node: 'book_slot' },
    back: false,
  };

  const bare: WorkflowSpec = {
    title: 'Booking',
    nodes: [
      { id: 'find_slot', kind: 'step', title: 'Find slot', config: {} },
      { id: 'book_slot', kind: 'step', title: 'Book slot', config: {} },
    ],
    edges: [wire],
  };

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

  const propose = (): Promise<ProposeOutcome> =>
    proposeSpec(project.mbossDir, {
      name: 'booking',
      spec: bare,
      baseRevision: 1,
      proposedBy: 'claude code',
    });

  beforeEach(async () => {
    project = await makeProject();

    await applySpec(project.mbossDir, {
      name: 'booking',
      spec: placed,
      baseRevision: null,
    });
  });

  afterEach(async () => {
    await removeProject(project);
  });

  it('files the spec as it was written, with no coordinates in it', async () => {
    const stored = await readProposal(project.mbossDir, idOf(await propose()));

    expect(stored?.spec.nodes).toStrictEqual([
      { id: 'find_slot', kind: 'step', title: 'Find slot', config: {} },
      { id: 'book_slot', kind: 'step', title: 'Book slot', config: {} },
    ]);
  });

  /**
   * The line a person reads before approving. A
   * dragged block is not an edit, so a proposal
   * that only leaves the coordinates out has to
   * read as the nothing it is rather than as every
   * block in the workflow changed.
   */
  it('summarises a spec that only leaves the positions out as no change', async () => {
    const outcome = await propose();

    expect(outcome).toMatchObject({
      ok: true,
      proposal: {
        summary: {
          nodesAdded: 0,
          nodesRemoved: 0,
          nodesChanged: 0,
          edgesAdded: 0,
          edgesRemoved: 0,
        },
      },
    });
  });

  it('keeps the layout when the proposal lands', async () => {
    const id = idOf(await propose());

    expect(await applyProposal(project.mbossDir, id)).toMatchObject({
      ok: true,
      ir: {
        revision: 2,
        nodes: [
          { id: 'find_slot', position: { x: 120, y: 80 } },
          { id: 'book_slot', position: { x: 120, y: 212 } },
        ],
      },
    });
  });
});
