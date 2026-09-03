import { describe, expect, it } from 'vitest';

import {
  WorkflowIRSchema,
  type Position,
  type WorkflowIR,
} from '../ir/index.js';
import {
  canonicalJson,
  expectGolden,
  readFixtureJson,
} from '../test-support/fixtures.js';

import { layout, place } from './index.js';

function readIR(rel: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(rel));
}

/**
 * The same document after somebody dragged the
 * named blocks, and only those.
 */
function positioned(
  ir: WorkflowIR,
  positions: Record<string, Position>,
): WorkflowIR {
  return {
    ...ir,
    nodes: ir.nodes.map((node) => {
      const position = positions[node.id];

      return position ? { ...node, position } : node;
    }),
  };
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

describe('place', () => {
  it('lays out a document nobody has placed a block in', async () => {
    const ir = readIR('ir/groom_booking.workflow.json');

    expect(await place(ir)).toEqual(await layout(ir));
  });

  it('takes every box from the document once every block is placed', async () => {
    const ir = positioned(readIR('ir/timer_wait.workflow.json'), {
      booking_placed: { x: 40, y: 100 },
      settle_delay: { x: 40, y: 300 },
      record_booking: { x: 320, y: 700 },
    });

    expect(await place(ir)).toEqual(
      new Map([
        ['booking_placed', { x: 40, y: 100, w: 230, h: 60 }],
        ['settle_delay', { x: 40, y: 300, w: 230, h: 60 }],
        ['record_booking', { x: 320, y: 700, w: 230, h: 60 }],
      ]),
    );
  });

  it('parks the blocks nobody has placed under the ones somebody has', async () => {
    const ir = positioned(readIR('ir/form_intake.workflow.json'), {
      ask_details: { x: 300, y: 400 },
      record_intake: { x: 120, y: 180 },
    });

    expect(await place(ir)).toEqual(
      new Map([
        // In document order, in a column at the
        // left edge of the placed set, starting
        // under the lowest of them.
        ['intake_requested', { x: 120, y: 532, w: 230, h: 60 }],
        ['ask_details', { x: 300, y: 400, w: 230, h: 60 }],
        ['await_details', { x: 120, y: 664, w: 230, h: 60 }],
        ['record_intake', { x: 120, y: 180, w: 230, h: 60 }],
      ]),
    );
  });
});
