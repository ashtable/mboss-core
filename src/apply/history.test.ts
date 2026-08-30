import { readdir } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeProject,
  removeProject,
  type TestProject,
} from '../test-support/project.js';

import { HISTORY_LIMIT, listSnapshots } from './history.js';
import { applyProposal, applySpec, proposeSpec, undo } from './index.js';
import { historyDir } from './paths.js';
import type { WorkflowSpec } from './proposal.js';

/**
 * History exists for one reason — undo — and undo
 * has one rule that is not obvious: the revision
 * still goes up. Moving the counter backwards
 * would let an outstanding proposal's base
 * revision match content it was never proposed
 * against, and the proposal would apply as though
 * nothing had happened.
 */
describe('history and undo', () => {
  let project: TestProject;

  const step = (id: string, title: string): WorkflowSpec => ({
    title,
    nodes: [{ id, kind: 'step', title, config: {} }],
    edges: [],
  });

  const apply = (
    spec: WorkflowSpec,
    baseRevision: number | null,
  ): ReturnType<typeof applySpec> =>
    applySpec(project.mbossDir, { name: 'booking', spec, baseRevision });

  beforeEach(async () => {
    project = await makeProject();
  });

  afterEach(async () => {
    await removeProject(project);
  });

  it('keeps only the most recent snapshots, oldest pruned first', async () => {
    await apply(step('find_slot', 'Booking 1'), null);

    for (let revision = 1; revision <= 24; revision += 1) {
      await apply(step('find_slot', `Booking ${revision + 1}`), revision);
    }

    const snapshots = await listSnapshots(project.mbossDir, 'booking');

    expect(snapshots).toHaveLength(HISTORY_LIMIT);
    expect(snapshots.map((snapshot) => snapshot.ir.revision)).toEqual(
      Array.from({ length: HISTORY_LIMIT }, (_, index) => 5 + index),
    );
  });

  it('does not snapshot a workflow that did not exist yet', async () => {
    await apply(step('find_slot', 'Booking'), null);

    expect(await listSnapshots(project.mbossDir, 'booking')).toEqual([]);
  });

  it('keeps each workflow history to itself', async () => {
    await apply(step('find_slot', 'Booking'), null);
    await apply(step('find_slot', 'Booking again'), 1);

    await applySpec(project.mbossDir, {
      name: 'refunds',
      spec: step('start_refund', 'Refunds'),
      baseRevision: null,
    });

    const booking = await listSnapshots(project.mbossDir, 'booking');
    const refunds = await listSnapshots(project.mbossDir, 'refunds');

    expect(booking).toHaveLength(1);
    expect(refunds).toEqual([]);
    expect(await readdir(historyDir(project.mbossDir))).toHaveLength(1);
  });

  it('restores the previous document and still moves the revision forward', async () => {
    await apply(step('find_slot', 'First'), null);
    await apply(step('book_slot', 'Second'), 1);

    const undone = await undo(project.mbossDir, 'booking');

    expect(undone).toMatchObject({
      ok: true,
      ir: {
        revision: 3,
        title: 'First',
        nodes: [{ id: 'find_slot' }],
      },
    });
  });

  it('walks backwards through history rather than toggling', async () => {
    await apply(step('n1', 'First'), null);
    await apply(step('n2', 'Second'), 1);
    await apply(step('n3', 'Third'), 2);

    const back = await undo(project.mbossDir, 'booking');
    const further = await undo(project.mbossDir, 'booking');

    expect(back).toMatchObject({
      ok: true,
      ir: { revision: 4, title: 'Second' },
    });
    expect(further).toMatchObject({
      ok: true,
      ir: { revision: 5, title: 'First' },
    });
  });

  it('has nothing to undo on a workflow that was only ever created', async () => {
    await apply(step('find_slot', 'Booking'), null);

    expect(await undo(project.mbossDir, 'booking')).toMatchObject({
      ok: false,
      error: { code: 'NOTHING_TO_UNDO', name: 'booking' },
    });
  });

  it('refuses to undo a workflow that is not there', async () => {
    expect(await undo(project.mbossDir, 'booking')).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_NOT_FOUND', name: 'booking' },
    });
  });

  /**
   * The reason undo may not put the revision back:
   * this proposal was written against revision 2,
   * and after the undo the file holds different
   * content. A counter that went backwards would
   * have made this proposal appliable again.
   */
  it('leaves a proposal minted before an undo stale', async () => {
    await apply(step('find_slot', 'First'), null);
    await apply(step('book_slot', 'Second'), 1);

    const proposed = await proposeSpec(project.mbossDir, {
      name: 'booking',
      spec: step('notify', 'Third'),
      baseRevision: 2,
      proposedBy: 'claude code',
    });
    if (!proposed.ok) throw new Error(proposed.error.code);

    await undo(project.mbossDir, 'booking');

    expect(
      await applyProposal(project.mbossDir, proposed.proposal.id),
    ).toMatchObject({
      ok: false,
      error: { code: 'PROPOSAL_STALE', baseRevision: 2, currentRevision: 3 },
    });
  });
});
