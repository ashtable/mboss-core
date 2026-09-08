import { describe, expect, it } from 'vitest';

import type { QueueEntry } from './app/contract.js';
import { queueKey, registerQueues, type QueuePort } from './app/queues.js';

/**
 * Registering the queues the registry declares,
 * and naming the key one item is queued under.
 *
 * Both are runtime, both are copied into every
 * project, and neither is reachable from a
 * type-check or a golden: registering is a call
 * against the system database, and the key is read
 * off an item nobody has seen yet.
 */

function recording() {
  const registered: { name: string; options: QueueEntry['options'] }[] = [];
  const port: QueuePort & { deleteQueue(name: string): Promise<void> } = {
    async registerQueue(name, options) {
      registered.push({ name, options });
      return undefined;
    },
    async deleteQueue(name) {
      registered.push({ name, options: {} });
      throw new Error(`deleted ${name}`);
    },
  };

  return { registered, port };
}

function entry(name: string): QueueEntry {
  return { name, options: { globalConcurrency: 4 } };
}

describe('registerQueues', () => {
  it('registers every queue the registry declares', async () => {
    const { registered, port } = recording();

    await registerQueues([entry('renders'), entry('emails')], port);

    expect(registered).toEqual([
      { name: 'renders', options: { globalConcurrency: 4 } },
      { name: 'emails', options: { globalConcurrency: 4 } },
    ]);
  });

  it('registers them in the order the registry lists them', async () => {
    const { registered, port } = recording();

    await registerQueues(['a', 'b', 'c'].map(entry), port);

    expect(registered.map((call) => call.name)).toEqual(['a', 'b', 'c']);
  });

  it('registers nothing when the registry declares nothing', async () => {
    const { registered, port } = recording();

    await registerQueues([], port);

    expect(registered).toEqual([]);
  });

  it('never deletes a queue, whatever the registry stopped saying', async () => {
    // The counterpart of pruning a schedule, and
    // deliberately not done. A queue nobody
    // enqueues to does nothing, and deleting one
    // strands the rows already sitting on it.
    const { registered, port } = recording();

    await registerQueues([entry('renders')], port);

    expect(registered.map((call) => call.name)).toEqual(['renders']);
  });
});

describe('queueKey', () => {
  it('is the value it was handed', () => {
    expect(queueKey('fan_out', 'tenantId', 'acme')).toBe('acme');
  });

  it.each([
    ['a missing one', undefined],
    ['an empty one', ''],
    ['a number', 7],
  ])('refuses %s, naming the block and the path', (_what, value) => {
    // A partitioned queue never dequeues a row
    // with no key, so passing one on is a run that
    // waits for ever with nothing said.
    expect(() => queueKey('fan_out', 'tenantId', value)).toThrow(
      'fan_out: tenantId is missing on an item.',
    );
  });
});
