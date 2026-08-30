import { describe, expect, it } from 'vitest';

import { makeIR } from '../test-support/ir.js';

import { diffSummary } from './diff.js';

describe('diffSummary', () => {
  it('counts every node as added when there was nothing before', () => {
    const next = makeIR({
      nodes: [{ id: 'start' }, { id: 'finish' }],
      edges: [{ from: 'start', to: 'finish' }],
    });

    expect(diffSummary(undefined, next)).toEqual({
      nodesAdded: 2,
      nodesRemoved: 0,
      nodesChanged: 0,
      edgesAdded: 1,
      edgesRemoved: 0,
    });
  });

  it('counts nodes and edges appearing and disappearing', () => {
    const prev = makeIR({
      nodes: [{ id: 'start' }, { id: 'middle' }, { id: 'finish' }],
      edges: [
        { id: 'e1', from: 'start', to: 'middle' },
        { id: 'e2', from: 'middle', to: 'finish' },
      ],
    });
    const next = makeIR({
      nodes: [{ id: 'start' }, { id: 'finish' }, { id: 'notify' }],
      edges: [
        { id: 'e3', from: 'start', to: 'finish' },
        { id: 'e4', from: 'finish', to: 'notify' },
      ],
    });

    expect(diffSummary(prev, next)).toEqual({
      nodesAdded: 1,
      nodesRemoved: 1,
      nodesChanged: 0,
      edgesAdded: 2,
      edgesRemoved: 2,
    });
  });

  it('counts a node whose only change is inside its config', () => {
    const prev = makeIR({
      nodes: [
        {
          id: 'send_note',
          kind: 'emailSend',
          config: {
            to: 'requestingUser',
            subject: 'Booked',
            bodyMarkdown: 'You are booked.',
            attach: { type: 'none' },
          },
        },
      ],
    });
    const next = makeIR({
      nodes: [
        {
          id: 'send_note',
          kind: 'emailSend',
          config: {
            to: 'requestingUser',
            subject: 'Confirmed',
            bodyMarkdown: 'You are booked.',
            attach: { type: 'none' },
          },
        },
      ],
    });

    expect(diffSummary(prev, next)).toMatchObject({
      nodesAdded: 0,
      nodesRemoved: 0,
      nodesChanged: 1,
    });
  });

  it('counts a node whose title changed', () => {
    const prev = makeIR({ nodes: [{ id: 'find_slot', title: 'Find slot' }] });
    const next = makeIR({ nodes: [{ id: 'find_slot', title: 'Find a slot' }] });

    expect(diffSummary(prev, next).nodesChanged).toBe(1);
  });

  it('sees no change in a document reordered but not edited', () => {
    const prev = makeIR({
      nodes: [{ id: 'start' }, { id: 'finish' }],
      edges: [{ from: 'start', to: 'finish' }],
    });
    const next = makeIR({
      nodes: [{ id: 'finish' }, { id: 'start' }],
      edges: [{ from: 'start', to: 'finish' }],
    });

    expect(diffSummary(prev, next)).toEqual({
      nodesAdded: 0,
      nodesRemoved: 0,
      nodesChanged: 0,
      edgesAdded: 0,
      edgesRemoved: 0,
    });
  });
});
