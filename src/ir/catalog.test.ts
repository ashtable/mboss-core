import { describe, expect, it } from 'vitest';

import { NODE_PALETTE, NodeKindSchema, NodeSchema, portsOf } from './index.js';

const minimalNodes = [
  { kind: 'trigger', config: { mode: 'manual' } },
  { kind: 'step', config: {} },
  { kind: 'transaction', config: {} },
  { kind: 'apiCall', config: { service: 'stripe' } },
  {
    kind: 'branch',
    config: {
      cases: [{ port: 'yes', when: { path: 'ok', op: 'exists' } }],
      elsePort: 'no',
    },
  },
  { kind: 'loop', config: { minRounds: 1, maxRounds: 3, body: ['draft'] } },
  {
    kind: 'durableWait',
    config: { source: { kind: 'timer', seconds: 60 }, onTimeout: 'abort' },
  },
  { kind: 'approval', config: { to: 'requestingUser' } },
  {
    kind: 'emailSend',
    config: {
      to: 'requestingUser',
      subject: 'Your booking',
      bodyMarkdown: 'Confirmed.',
      attach: { type: 'none' },
    },
  },
  { kind: 'codeStep', config: {} },
];

describe('every kind in the catalog', () => {
  it.each(minimalNodes)('accepts a minimal $kind node', ({ kind, config }) => {
    const parsed = NodeSchema.safeParse({
      id: 'a_node',
      kind,
      title: 'A node',
      config,
    });

    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it('has one minimal node above for each kind, so none goes untested', () => {
    expect(minimalNodes.map((node) => node.kind).sort()).toEqual(
      [...NodeKindSchema.options].sort(),
    );
  });
});

describe('per-kind config rules', () => {
  const node = (kind: string, config: unknown): unknown => ({
    id: 'a_node',
    kind,
    title: 'A node',
    config,
  });

  it('refuses an event trigger with no topic to listen on', () => {
    expect(
      NodeSchema.safeParse(node('trigger', { mode: 'event' })).success,
    ).toBe(false);
  });

  it('refuses a branch with no cases, which could only fall through', () => {
    expect(
      NodeSchema.safeParse(node('branch', { cases: [], elsePort: 'no' }))
        .success,
    ).toBe(false);
  });

  it('refuses a loop whose bound is below its floor', () => {
    expect(
      NodeSchema.safeParse(
        node('loop', { minRounds: 3, maxRounds: 2, body: ['draft'] }),
      ).success,
    ).toBe(false);
  });

  it('refuses an email that attaches a form without defining one', () => {
    expect(
      NodeSchema.safeParse(
        node('emailSend', {
          to: 'requestingUser',
          subject: 'Please confirm',
          bodyMarkdown: 'Details below.',
          attach: { type: 'form' },
        }),
      ).success,
    ).toBe(false);
  });
});

describe('an unknown kind', () => {
  it('is rejected against the kind itself, not against ten config shapes', () => {
    const parsed = NodeSchema.safeParse({
      id: 'a_node',
      kind: 'queue',
      title: 'A node',
      config: {},
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toHaveLength(1);
    expect(parsed.error?.issues[0]?.path).toEqual(['kind']);
  });
});

describe('portsOf', () => {
  it('gives an ordinary node its single out port', () => {
    const step = NodeSchema.parse({
      id: 'find_slot',
      kind: 'step',
      title: 'Find open slot',
      config: {},
    });

    expect(portsOf(step)).toEqual(['out']);
  });

  it('gives a branch every case port in order, then the else port', () => {
    const branch = NodeSchema.parse({
      id: 'reply_decision',
      kind: 'branch',
      title: 'Reply?',
      config: {
        cases: [
          { port: 'new_time', when: { path: 'intent', op: 'eq', value: 'r' } },
          { port: 'book_it', when: { path: 'intent', op: 'eq', value: 'b' } },
        ],
        elsePort: 'stop',
      },
    });

    expect(portsOf(branch)).toEqual(['new_time', 'book_it', 'stop']);
  });

  it('gives an approval the two ports its decision can take', () => {
    const approval = NodeSchema.parse({
      id: 'sign_off',
      kind: 'approval',
      title: 'Sign off',
      config: { to: 'requestingUser' },
    });

    expect(portsOf(approval)).toEqual(['approved', 'rejected']);
  });
});

describe('the palette', () => {
  it('offers every kind exactly once, so nothing is undrawable', () => {
    expect(NODE_PALETTE.map((entry) => entry.kind).sort()).toEqual(
      [...NodeKindSchema.options].sort(),
    );
  });
});
