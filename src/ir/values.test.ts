import { describe, expect, it } from 'vitest';

import { readFixtureJson } from '../test-support/fixtures.js';
import { makeIR } from '../test-support/ir.js';

import { WorkflowIRSchema, type WorkflowIR } from './index.js';
import { bindsValue, producers } from './values.js';

function fixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

function nodeOf(ir: WorkflowIR, id: string) {
  return ir.nodes.find((node) => node.id === id);
}

describe('bindsValue', () => {
  const ir = fixture('groom_booking');

  it('counts a block that runs code from the project', () => {
    expect(bindsValue(nodeOf(ir, 'parse_request'))).toBe(true);
  });

  it('does not count a branch, which chooses rather than produces', () => {
    expect(bindsValue(nodeOf(ir, 'slot_route'))).toBe(false);
  });

  it('answers no for a block that is not there', () => {
    expect(bindsValue(undefined)).toBe(false);
  });

  it('counts a wait for a person and not a wait on the clock', () => {
    const waits = makeIR({
      nodes: [
        { id: 'trigger', kind: 'trigger', config: { mode: 'manual' } },
        {
          id: 'timer',
          kind: 'durableWait',
          config: {
            source: { kind: 'timer', seconds: 60 },
            onTimeout: 'abort',
          },
        },
      ],
      edges: [],
    });

    expect(bindsValue(nodeOf(waits, 'timer'))).toBe(false);
  });
});

describe('producers', () => {
  it('names the block a value came from, not the wire it arrived on', () => {
    const found = producers(fixture('slot_retry_continue'));

    expect(found.get('find_slot')).toBe('parse_request');
    // A branch passes a value along without binding
    // one, so what follows still reads `find_slot`.
    expect(found.get('look_again')).toBe('find_slot');
    expect(found.get('book_appointment')).toBe('find_slot');
  });

  it('reads the payload from the trigger when nothing has bound one yet', () => {
    const found = producers(fixture('slot_retry_continue'));

    expect(found.get('parse_request')).toBe('booking_requested');
  });

  /**
   * The block between them binds nothing, so the
   * value carries past it — which is the case a
   * rule looking only at the wire out of a guarded
   * block cannot see.
   */
  it('looks past a block that only passes a value along', () => {
    const ir = makeIR({
      nodes: [
        { id: 'trigger', kind: 'trigger', config: { mode: 'manual' } },
        { id: 'parse', kind: 'step', out: 'Req' },
        {
          id: 'notify',
          kind: 'emailSend',
          config: {
            to: 'requestingUser',
            subject: 's',
            bodyMarkdown: 'b',
            attach: { type: 'none' },
          },
        },
        { id: 'consume', kind: 'step', in: 'Req' },
      ],
      edges: [
        { from: 'trigger', to: 'parse' },
        { from: 'parse', to: 'notify' },
        { from: 'notify', to: 'consume' },
      ],
    });

    expect(producers(ir).get('consume')).toBe('parse');
  });

  it('has nothing to say about a document with no trigger', () => {
    const ir = makeIR({ nodes: [{ id: 'a', kind: 'step' }], edges: [] });

    expect(producers(ir).size).toBe(0);
  });
});
