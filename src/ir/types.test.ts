import { describe, expect, it } from 'vitest';

import { readFixtureJson } from '../test-support/fixtures.js';
import { EdgeSchema, RetrySchema, WorkflowIRSchema } from './index.js';

const groomBooking = readFixtureJson<unknown>('ir/groom_booking.workflow.json');
const emptyDraft = readFixtureJson<unknown>('ir/empty_draft.workflow.json');

describe('the groom_booking document', () => {
  const ir = WorkflowIRSchema.parse(groomBooking);

  it('parses with every node and edge the canvas draws', () => {
    expect(ir.nodes).toHaveLength(10);
    expect(ir.edges).toHaveLength(11);
  });

  it('keeps the loop-closing edge marked as a back edge', () => {
    const e8 = ir.edges.find((edge) => edge.id === 'e8');

    expect(e8?.back).toBe(true);
    expect(e8?.from).toEqual({ node: 'reply_decision', port: 'new_time' });
    expect(e8?.to).toEqual({ node: 'find_slot' });
  });

  it('leaves the else port of a branch unconnected, which ends the run', () => {
    const replyDecision = ir.nodes.find((node) => node.id === 'reply_decision');
    if (replyDecision?.kind !== 'branch') {
      throw new Error('the fixture must keep reply_decision a branch');
    }

    expect(replyDecision.config.elsePort).toBe('stop');
    expect(
      ir.edges.some(
        (edge) =>
          edge.from.node === 'reply_decision' && edge.from.port === 'stop',
      ),
    ).toBe(false);
  });
});

describe('the empty draft', () => {
  it('parses with no nodes and no edges, because a blank canvas is a legal draft', () => {
    const ir = WorkflowIRSchema.parse(emptyDraft);

    expect(ir.nodes).toEqual([]);
    expect(ir.edges).toEqual([]);
  });
});

describe('defaults', () => {
  it('gives an edge written without a port the single out port', () => {
    const edge = EdgeSchema.parse({
      id: 'e1',
      from: { node: 'a' },
      to: { node: 'b' },
    });

    expect(edge.from.port).toBe('out');
  });

  it('treats an edge written without back as a forward edge', () => {
    const edge = EdgeSchema.parse({
      id: 'e1',
      from: { node: 'a' },
      to: { node: 'b' },
    });

    expect(edge.back).toBe(false);
  });

  it('fills an empty retry block with the whole policy', () => {
    expect(RetrySchema.parse({})).toEqual({
      maxAttempts: 3,
      intervalSeconds: 1,
      backoffRate: 2,
    });
  });
});

describe('rejections', () => {
  const valid = {
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 1,
    name: 'groom_booking',
    nodes: [],
    edges: [],
  };

  it('refuses a revision below one, since it only ever counts up', () => {
    expect(WorkflowIRSchema.safeParse({ ...valid, revision: 0 }).success).toBe(
      false,
    );
  });

  it('refuses a name that is not a lowercase slug', () => {
    expect(
      WorkflowIRSchema.safeParse({ ...valid, name: 'Groom' }).success,
    ).toBe(false);
    expect(
      WorkflowIRSchema.safeParse({ ...valid, name: '1groom' }).success,
    ).toBe(false);
  });

  it('refuses an edge id that is not e followed by digits', () => {
    expect(
      EdgeSchema.safeParse({ id: 'x1', from: { node: 'a' }, to: { node: 'b' } })
        .success,
    ).toBe(false);
  });

  it('refuses any $schema but the one this format is pinned to', () => {
    expect(
      WorkflowIRSchema.safeParse({
        ...valid,
        $schema: 'https://mboss.dev/schemas/workflow-v2.json',
      }).success,
    ).toBe(false);
  });
});
