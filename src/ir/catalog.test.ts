import { describe, expect, it } from 'vitest';

import {
  EnqueuePolicySchema,
  NODE_PALETTE,
  NodeKindSchema,
  NodeSchema,
  QueuePolicySchema,
  portsOf,
} from './index.js';

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
  {
    kind: 'queue',
    config: { itemsPath: 'pages', queue: { name: 'render_pages' } },
  },
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

  it('refuses a branch whose two cases leave by the same port', () => {
    // An edge names the port it leaves by, so two
    // cases sharing one leave no way to say which
    // edge belongs to which case.
    expect(
      NodeSchema.safeParse(
        node('branch', {
          cases: [
            { port: 'yes', when: { path: 'a', op: 'eq', value: 1 } },
            { port: 'yes', when: { path: 'b', op: 'eq', value: 2 } },
          ],
          elsePort: 'no',
        }),
      ).success,
    ).toBe(false);
  });

  it('refuses a branch whose fall-through shares a case’s port', () => {
    expect(
      NodeSchema.safeParse(
        node('branch', {
          cases: [{ port: 'yes', when: { path: 'ok', op: 'exists' } }],
          elsePort: 'yes',
        }),
      ).success,
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

  it('refuses a form whose two questions share an id', () => {
    // An answer names the field it answers, so two
    // questions sharing an id leave no way to say
    // which answer belongs to which — and the page
    // renders both under the one name.
    expect(
      NodeSchema.safeParse(
        node('emailSend', {
          to: 'requestingUser',
          subject: 'Please confirm',
          bodyMarkdown: 'Details below.',
          attach: {
            type: 'form',
            form: {
              fields: [
                { id: 'name', label: 'Your name', type: 'text' },
                { id: 'name', label: 'Say it again', type: 'text' },
              ],
            },
          },
        }),
      ).success,
    ).toBe(false);
  });

  it('takes a form whose questions each have an id of their own', () => {
    // Non-vacuous: the shape above is refused for
    // the shared id and not for anything else about
    // it.
    expect(
      NodeSchema.safeParse(
        node('emailSend', {
          to: 'requestingUser',
          subject: 'Please confirm',
          bodyMarkdown: 'Details below.',
          attach: {
            type: 'form',
            form: {
              fields: [
                { id: 'name', label: 'Your name', type: 'text' },
                { id: 'again', label: 'Say it again', type: 'text' },
              ],
            },
          },
        }),
      ).success,
    ).toBe(true);
  });
});

describe('what a queue holds', () => {
  const config = { itemsPath: 'pages', queue: { name: 'render_pages' } };

  it('drops a fan-out modifier instead of refusing the node', () => {
    // A queue is the fan-out, so `forEach` on one
    // has nothing left to say. The shape leaves the
    // key out rather than a rule turning the
    // document down, so a hand-written one loads
    // and the canvas can then show what it means.
    const parsed = NodeSchema.parse({
      id: 'render_pages',
      kind: 'queue',
      title: 'Render the pages',
      forEach: { itemsPath: 'pages' },
      config,
    });

    expect(parsed).not.toHaveProperty('forEach');
  });

  it.each([
    ['concurrency', 4],
    ['priorityEnabled', true],
    ['partitionQueue', true],
  ])('refuses `%s`, the deprecated way to say it', (key, value) => {
    // Refused rather than dropped: a limit written
    // the old way and quietly stripped is a queue
    // running unbounded with nothing said about it.
    const parsed = QueuePolicySchema.safeParse({
      name: 'render_pages',
      [key]: value,
    });

    expect(parsed.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('refuses an enqueue field the deployment owns', () => {
    const parsed = EnqueuePolicySchema.safeParse({
      priority: 1,
      applicationVersion: '1.2.3',
    });

    expect(parsed.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('takes the priorities the runtime has and no others', () => {
    // Its range, not a range of our own, so a
    // document cannot hold a number the enqueue
    // would turn down.
    expect(EnqueuePolicySchema.safeParse({ priority: 0 }).success).toBe(false);
    expect(
      EnqueuePolicySchema.safeParse({ priority: 2147483647 }).success,
    ).toBe(true);
  });
});

describe('an unknown kind', () => {
  it('is rejected against the kind itself, not eleven config shapes', () => {
    const parsed = NodeSchema.safeParse({
      id: 'a_node',
      kind: 'mapReduce',
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
