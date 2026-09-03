import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { readFixtureJson } from '../test-support/fixtures.js';

import { toElkGraph } from './graph.js';

function groomBooking(): WorkflowIR {
  return WorkflowIRSchema.parse(
    readFixtureJson('ir/groom_booking.workflow.json'),
  );
}

/**
 * A different order for the same document. The
 * property under test is that input order never
 * reaches the output, and reversing both arrays
 * moves every element that can move.
 */
function reordered(ir: WorkflowIR): WorkflowIR {
  return {
    ...ir,
    nodes: [...ir.nodes].reverse(),
    edges: [...ir.edges].reverse(),
  };
}

describe('toElkGraph', () => {
  it('builds the same graph whatever order the nodes and edges arrive in', () => {
    const asWritten = toElkGraph(groomBooking());
    const shuffled = toElkGraph(reordered(groomBooking()));

    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(asWritten));
  });

  it('emits a back edge with its source and target swapped', () => {
    const graph = toElkGraph(groomBooking());

    expect(graph.edges?.find((edge) => edge.id === 'e8')).toEqual({
      id: 'e8',
      sources: ['find_slot'],
      targets: ['reply_decision.new_time'],
    });
  });

  it('gives a two-case branch a port per case plus its else port', () => {
    const graph = toElkGraph(groomBooking());
    const branch = graph.children?.find(
      (child) => child.id === 'reply_decision',
    );

    expect(branch?.ports?.map((port) => port.id)).toEqual([
      'reply_decision.new_time',
      'reply_decision.book_it',
      'reply_decision.stop',
    ]);
  });

  it("leaves a branch's outgoing edges attached to its ports", () => {
    const graph = toElkGraph(groomBooking());

    expect(graph.edges?.find((edge) => edge.id === 'e9')?.sources).toEqual([
      'reply_decision.book_it',
    ]);
    expect(graph.edges?.find((edge) => edge.id === 'e5')?.sources).toEqual([
      'slot_open.no',
    ]);
  });

  it('gives a single-outcome node no ports, so its edges name the node', () => {
    const graph = toElkGraph(groomBooking());
    const step = graph.children?.find((child) => child.id === 'find_slot');

    expect(step?.ports).toBeUndefined();
    expect(graph.edges?.find((edge) => edge.id === 'e3')?.sources).toEqual([
      'find_slot',
    ]);
  });

  it('sizes every node from the metrics table', () => {
    const graph = toElkGraph(groomBooking());

    for (const child of graph.children ?? []) {
      expect(child.width).toBe(230);
      expect(child.height).toBe(60);
    }
  });
});
