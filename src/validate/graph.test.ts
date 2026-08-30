import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { readFixtureJson } from '../test-support/fixtures.js';
import { makeIR } from '../test-support/ir.js';

import { buildGraph, dominators, isDag, reachableFrom } from './graph.js';

function groomBooking(): WorkflowIR {
  return WorkflowIRSchema.parse(
    readFixtureJson('ir/groom_booking.workflow.json'),
  );
}

/**
 * A chain with a node nothing points at. The
 * island is what an author leaves behind
 * mid-edit — a block dropped on the canvas before
 * it is wired up.
 */
function chainWithIsland(): WorkflowIR {
  return makeIR({
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'island' }],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  });
}

/**
 * `a` splits into `b` and `c`, which meet again at
 * `d`. Every path to `d` runs through `a` and no
 * path has to run through `b`, which is the whole
 * of what dominance means.
 */
function diamond(): WorkflowIR {
  return makeIR({
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ],
  });
}

describe('reachableFrom', () => {
  it('reaches the chain and leaves the island out', () => {
    const reached = reachableFrom(buildGraph(chainWithIsland()), 'a');

    expect([...reached].sort()).toEqual(['a', 'b', 'c']);
  });

  it('reaches everything in the canonical workflow from its trigger', () => {
    const ir = groomBooking();
    const reached = reachableFrom(buildGraph(ir), 'booking_requested');

    expect(reached.size).toBe(ir.nodes.length);
  });

  it('ignores an edge naming a node that does not exist', () => {
    const ir = makeIR({
      nodes: [{ id: 'a' }],
      edges: [{ from: 'a', to: 'gone' }],
    });

    expect([...reachableFrom(buildGraph(ir), 'a')]).toEqual(['a']);
  });
});

describe('isDag', () => {
  it('accepts a graph with no cycle at all', () => {
    expect(isDag(buildGraph(diamond()))).toBe(true);
  });

  it('rejects a cycle drawn with ordinary edges', () => {
    const ir = makeIR({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'b' },
      ],
    });

    expect(isDag(buildGraph(ir))).toBe(false);
  });

  it('accepts the same cycle once its closing edge is declared', () => {
    const ir = makeIR({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'b', back: true },
      ],
    });

    expect(isDag(buildGraph(ir))).toBe(true);
  });
});

describe('dominators', () => {
  it('finds the node every path to the join runs through', () => {
    const doms = dominators(buildGraph(diamond()), 'a');

    expect(doms.get('d')?.has('a')).toBe(true);
    expect(doms.get('d')?.has('b')).toBe(false);
    expect(doms.get('d')?.has('c')).toBe(false);
  });

  it('counts a node as its own dominator', () => {
    const doms = dominators(buildGraph(diamond()), 'a');

    expect(doms.get('d')?.has('d')).toBe(true);
    expect([...(doms.get('a') ?? [])]).toEqual(['a']);
  });

  it('leaves out a node the root cannot reach', () => {
    const doms = dominators(buildGraph(chainWithIsland()), 'a');

    expect(doms.has('island')).toBe(false);
  });

  it('finds the loop target that dominates the branch closing the loop', () => {
    const doms = dominators(buildGraph(groomBooking()), 'booking_requested');

    expect(doms.get('reply_decision')?.has('find_slot')).toBe(true);
    expect(doms.get('reply_decision')?.has('book_appointment')).toBe(false);
  });

  it('ignores the loop-closing edge, so the branch does not dominate itself into the loop', () => {
    // Dominance is asked of the forward graph
    // alone. Counting the back edge as a way in to
    // `find_slot` would let the branch that closes
    // the loop stand between the trigger and the
    // node it loops back to.
    const doms = dominators(buildGraph(groomBooking()), 'booking_requested');

    expect(doms.get('find_slot')?.has('reply_decision')).toBe(false);
  });
});
