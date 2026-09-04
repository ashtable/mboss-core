import { describe, expect, it } from 'vitest';

import { NodeSchema, type WorkflowNode } from '../ir/index.js';
import type { LibFunction } from '../manifest/types.js';
import type { NodeSpec } from '../test-support/ir.js';

import { decisionValues, handlerFit } from './handler-fit.js';

/**
 * One node, parsed the way a document's nodes are,
 * so no case here is built out of a block that
 * could not exist on disk.
 */
function node(spec: NodeSpec): WorkflowNode {
  return NodeSchema.parse({
    kind: 'step',
    title: spec.id,
    config: {},
    ...spec,
  });
}

/**
 * One scanned function, with whatever the case is
 * not about filled in.
 */
function fn(parts: Partial<LibFunction>): LibFunction {
  return {
    export: 'findSlot',
    file: 'lib/findSlot.ts',
    params: [{ name: 'req', type: 'BookingReq' }],
    returnType: 'SlotGrid',
    ...parts,
  };
}

const BRANCH: NodeSpec = {
  id: 'decide',
  kind: 'branch',
  config: {
    cases: [{ port: 'yes', when: { path: '', op: 'eq', value: true } }],
    elsePort: 'no',
  },
};

describe('handlerFit', () => {
  it('fits a step whose declarations match its handler', () => {
    const work = node({ id: 'find_slot', in: 'BookingReq', out: 'SlotGrid' });

    expect(handlerFit(work, fn({}))).toEqual({ fits: true });
  });

  it('refuses a kind that never runs code of the author’s', () => {
    const approval = node({
      id: 'sign_off',
      kind: 'approval',
      config: { to: 'ops@example.com' },
    });

    expect(handlerFit(approval, fn({}))).toEqual({
      fits: false,
      reason: { kind: 'no-handler-kind' },
    });
  });

  it('refuses a function with a second value nothing can hand it', () => {
    const takesTwo = fn({
      params: [
        { name: 'req', type: 'BookingReq' },
        { name: 'grid', type: 'SlotGrid' },
      ],
    });
    const work = node({ id: 'find_slot', in: 'BookingReq' });

    expect(handlerFit(work, takesTwo)).toEqual({
      fits: false,
      reason: { kind: 'too-many-params', count: 2 },
    });
  });

  it('fits a function whose second value a call may leave out', () => {
    const withOptions = fn({
      params: [
        { name: 'req', type: 'BookingReq' },
        { name: 'options', type: 'FindOptions', optional: true },
      ],
    });
    const work = node({ id: 'find_slot', in: 'BookingReq' });

    expect(handlerFit(work, withOptions)).toEqual({ fits: true });
  });

  it('refuses an input the handler does not take', () => {
    const work = node({ id: 'find_slot', in: 'SlotGrid' });

    expect(handlerFit(work, fn({}))).toEqual({
      fits: false,
      reason: {
        kind: 'input-mismatch',
        declared: 'SlotGrid',
        takes: 'BookingReq',
      },
    });
  });

  it('refuses an output the handler does not return', () => {
    const work = node({ id: 'find_slot', out: 'Booking' });

    expect(handlerFit(work, fn({}))).toEqual({
      fits: false,
      reason: {
        kind: 'output-mismatch',
        declared: 'Booking',
        returns: 'SlotGrid',
      },
    });
  });

  it('fits a node that fans out, whose names are meant to differ', () => {
    const fanOut = node({
      id: 'find_slot',
      in: 'SlotGrid',
      out: 'Booking',
      forEach: { itemsPath: 'items' },
    });

    expect(handlerFit(fanOut, fn({}))).toEqual({ fits: true });
  });

  it('fits wherever the handler’s type is not a plain name', () => {
    const overArrays = fn({
      params: [{ name: 'items', type: 'Booking[]' }],
      returnType: 'Booking[]',
    });
    const work = node({ id: 'count_all', in: 'Booking', out: 'Booking' });

    expect(handlerFit(work, overArrays)).toEqual({ fits: true });
  });

  it('refuses a branch a function decides nothing for', () => {
    expect(handlerFit(node(BRANCH), fn({}))).toEqual({
      fits: false,
      reason: { kind: 'not-a-decision', returns: 'SlotGrid' },
    });
  });

  it('fits a branch whose handler returns a boolean', () => {
    const decides = fn({
      export: 'checkDone',
      params: [],
      returnType: 'boolean',
    });

    expect(handlerFit(node(BRANCH), decides)).toEqual({ fits: true });
  });

  it('fits a branch whose alias the scan resolved to a decision', () => {
    // The text says `Verdict`, which decides
    // nothing on its own; the recorded values say
    // what that name turned out to mean.
    const aliased = fn({
      export: 'judge',
      params: [],
      returnType: 'Verdict',
      decision: ['yes', 'no'],
    });

    expect(handlerFit(node(BRANCH), aliased)).toEqual({ fits: true });
  });

  it('fits a branch that says what leaves it, which is not what it decides', () => {
    // What leaves a branch is what arrived at it.
    // The decision picks the way out and is read by
    // nothing downstream, so it has no business
    // agreeing with the node's `out`.
    const decides = fn({
      export: 'checkDone',
      params: [],
      returnType: 'boolean',
    });

    expect(handlerFit(node({ ...BRANCH, out: 'ChatReply' }), decides)).toEqual({
      fits: true,
    });
  });

  it('refuses a transaction whose handler reaches another system', () => {
    const chargeCard = fn({
      export: 'chargeCard',
      file: 'lib/chargeCard.ts',
      externalCalls: [{ callee: 'fetch', via: 'globalThis', line: 12 }],
    });
    const write = node({ id: 'pay_claim', kind: 'transaction' });

    expect(handlerFit(write, chargeCard)).toEqual({
      fits: false,
      reason: {
        kind: 'external-call',
        callee: 'fetch',
        via: 'globalThis',
        file: 'lib/chargeCard.ts',
        line: 12,
      },
    });
  });

  it('fits the same handler on a step, which is where it belongs', () => {
    const chargeCard = fn({
      externalCalls: [{ callee: 'fetch', via: 'globalThis', line: 12 }],
    });

    expect(handlerFit(node({ id: 'pay_claim' }), chargeCard)).toEqual({
      fits: true,
    });
  });

  it('fits the same handler on a call to an API', () => {
    const chargeCard = fn({
      externalCalls: [{ callee: 'request', via: 'node:https', line: 4 }],
    });
    const call = node({
      id: 'pay_claim',
      kind: 'apiCall',
      config: { service: 'payments' },
    });

    expect(handlerFit(call, chargeCard)).toEqual({ fits: true });
  });

  it('fits a transaction whose handler the scan said nothing about', () => {
    // Absence is what a cache an older build wrote
    // says about every function in it, so it can
    // only mean the handler fits.
    const write = node({ id: 'record_booking', kind: 'transaction' });

    expect(handlerFit(write, fn({}))).toEqual({ fits: true });
  });

  it('fits a transaction whose handler reaches nothing', () => {
    const write = node({ id: 'record_booking', kind: 'transaction' });

    expect(handlerFit(write, fn({ externalCalls: [] }))).toEqual({
      fits: true,
    });
  });

  it('reports the first call and not every one', () => {
    const chargeCard = fn({
      externalCalls: [
        { callee: 'fetch', via: 'globalThis', line: 12 },
        { callee: 'request', via: 'node:https', line: 20 },
      ],
    });
    const write = node({ id: 'pay_claim', kind: 'transaction' });

    expect(handlerFit(write, chargeCard)).toEqual({
      fits: false,
      reason: {
        kind: 'external-call',
        callee: 'fetch',
        via: 'globalThis',
        file: 'lib/findSlot.ts',
        line: 12,
      },
    });
  });

  it('says this before anything about the signature', () => {
    // The repair is a different one. A parameter
    // or a type is fixed by editing a declaration;
    // this is fixed by making the block a step,
    // and a person who corrects their parameters
    // first has been sent down the wrong road.
    const chargeCard = fn({
      params: [
        { name: 'claim', type: 'ExpenseClaim' },
        { name: 'card', type: 'Card' },
      ],
      externalCalls: [{ callee: 'fetch', via: 'globalThis', line: 12 }],
    });
    const write = node({
      id: 'pay_claim',
      kind: 'transaction',
      in: 'Booking',
    });
    const fit = handlerFit(write, chargeCard);

    expect(fit.fits ? undefined : fit.reason.kind).toBe('external-call');
  });

  it('says it about a transaction that fans out, like any other', () => {
    // The exemption below it is about names that
    // are meant to differ; without this above it,
    // a transaction that fans out would be the one
    // shape never looked at.
    const chargeCard = fn({
      externalCalls: [{ callee: 'fetch', via: 'globalThis', line: 12 }],
    });
    const write = node({
      id: 'pay_claims',
      kind: 'transaction',
      in: 'ClaimBatch',
      forEach: { itemsPath: 'items' },
    });
    const fit = handlerFit(write, chargeCard);

    expect(fit.fits ? undefined : fit.reason.kind).toBe('external-call');
  });

  it('refuses a branch whose handler takes something else', () => {
    const decides = fn({
      export: 'checkDone',
      params: [{ name: 'reply', type: 'ChatReply' }],
      returnType: 'boolean',
    });

    expect(handlerFit(node({ ...BRANCH, in: 'BookingReq' }), decides)).toEqual({
      fits: false,
      reason: {
        kind: 'input-mismatch',
        declared: 'BookingReq',
        takes: 'ChatReply',
      },
    });
  });
});

describe('decisionValues', () => {
  it('reads the values the scan recorded', () => {
    const aliased = fn({ returnType: 'Verdict', decision: ['yes', 'no'] });

    expect(decisionValues(aliased)).toEqual(['yes', 'no']);
  });

  it('reads a boolean out of an older cache’s text', () => {
    expect(decisionValues(fn({ returnType: 'boolean' }))).toEqual([
      true,
      false,
    ]);
  });

  it('reads a union of string literals in either quote style', () => {
    expect(decisionValues(fn({ returnType: "'yes' | 'no'" }))).toEqual([
      'yes',
      'no',
    ]);
    expect(decisionValues(fn({ returnType: '"yes" | "no"' }))).toEqual([
      'yes',
      'no',
    ]);
  });

  it('decides nothing for a type that is not a decision', () => {
    expect(decisionValues(fn({ returnType: 'SlotGrid' }))).toBeUndefined();
  });

  it('decides nothing for an alias an older cache did not resolve', () => {
    // Greyed in the picker until `lib/` next
    // changes, which is the price of serving a
    // cache the build that wrote it never saw.
    expect(decisionValues(fn({ returnType: 'Verdict' }))).toBeUndefined();
  });
});
