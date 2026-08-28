import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import {
  canonicalJson,
  expectGolden,
  readFixtureJson,
} from '../test-support/fixtures.js';

import { layout } from './index.js';

function readIR(rel: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(rel));
}

/**
 * A different order for the same document. The
 * property under test is that the order a document
 * lists its nodes and edges in never reaches the
 * coordinates, and reversing both arrays moves
 * every element that can move.
 */
function reordered(ir: WorkflowIR): WorkflowIR {
  return {
    ...ir,
    nodes: [...ir.nodes].reverse(),
    edges: [...ir.edges].reverse(),
  };
}

describe('layout', () => {
  it('puts a document in the same place twice in one process', async () => {
    const ir = readIR('ir/groom_booking.workflow.json');

    expect(await layout(ir)).toEqual(await layout(ir));
  });

  it('ignores the order the nodes and edges are listed in', async () => {
    const ir = readIR('ir/groom_booking.workflow.json');

    expect(await layout(reordered(ir))).toEqual(await layout(ir));
  });

  it('lays out an empty draft as an empty map', async () => {
    const ir = readIR('ir/empty_draft.workflow.json');

    expect(await layout(ir)).toEqual(new Map());
  });

  it('returns a box for every node in the document', async () => {
    const ir = readIR('ir/groom_booking.workflow.json');
    const boxes = await layout(ir);

    expect([...boxes.keys()].sort()).toEqual(
      ir.nodes.map((node) => node.id).sort(),
    );
  });

  it('puts the canonical workflow exactly where it was blessed', async () => {
    const boxes = await layout(readIR('ir/groom_booking.workflow.json'));

    expectGolden(
      'golden/layout/groom_booking.layout.json',
      canonicalJson(Object.fromEntries(boxes)),
    );
  });
});
