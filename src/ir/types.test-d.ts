/**
 * Compile-time contract for the inferred
 * IR types. `tsc --noEmit` (part of
 * `npm run lint`) is the assertion: every
 * `@ts-expect-error` below fails the build
 * if the error it expects disappears.
 *
 * These are the mistakes the discriminated
 * union exists to catch — an author reaching
 * for a kind that is not in the catalog, or
 * pairing a kind with another kind's config.
 */
import type { z } from 'zod';

import type {
  EnqueuePolicySchema,
  Position,
  QueuePolicySchema,
  WorkflowEdge,
  WorkflowIR,
  WorkflowNode,
} from './index.js';

const ir: WorkflowIR = {
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 12,
  name: 'groom_booking',
  title: 'Groom booking',
  nodes: [
    {
      id: 'booking_requested',
      kind: 'trigger',
      title: 'Booking request',
      config: { mode: 'event', topic: 'booking.requested' },
      out: 'WebhookEvent',
    },
    {
      id: 'parse_request',
      kind: 'step',
      title: 'Parse request',
      handler: { export: 'parseRequest' },
      in: 'WebhookEvent',
      config: {},
      position: { x: 240, y: 120 },
    },
  ],
  edges: [
    {
      id: 'e1',
      from: { node: 'booking_requested', port: 'out' },
      to: { node: 'parse_request' },
      type: 'WebhookEvent',
      back: false,
    },
  ],
};

const unknownKind: WorkflowNode = {
  id: 'inbox',
  // @ts-expect-error the catalog is the whole
  // list; a word that is not on it is not a kind
  kind: 'mapReduce',
  title: 'Inbox',
  config: {},
};

// @ts-expect-error a step carries no config of
// its own — naming a service is what an apiCall
// is for
const stepWithService: WorkflowNode = {
  id: 'parse_request',
  kind: 'step',
  title: 'Parse request',
  config: { service: 'stripe' },
};

const emailConfig: Extract<WorkflowNode, { kind: 'emailSend' }>['config'] = {
  to: 'requestingUser',
  subject: 'Your booking is confirmed',
  bodyMarkdown: '…',
  attach: { type: 'none' },
};

// @ts-expect-error a branch decides where the run
// goes; it cannot be handed an email to send
const branchWithEmailConfig: WorkflowNode = {
  id: 'slot_open',
  kind: 'branch',
  title: 'Open at requested time?',
  config: emailConfig,
};

const edgeWithoutSource: WorkflowEdge = {
  id: 'e1',
  // @ts-expect-error the port has a default; the
  // node an edge leaves from never does
  from: { port: 'out' },
  to: { node: 'parse_request' },
  back: false,
};

// @ts-expect-error a position is a point, so a
// node given one coordinate still has nowhere
// to sit
const halfPlaced: Position = { x: 412 };

/**
 * The two queue policies do not overlap. What the
 * queue is registered with is settled once for
 * every item that ever lands in it; what an
 * enqueue is given is read off the item in hand.
 */
const queueWithEnqueueOption: z.input<typeof QueuePolicySchema> = {
  name: 'index_pages',
  // @ts-expect-error a priority orders one item
  // against the rest; the queue has no priority
  priority: 3,
};

const enqueueWithQueueOption: z.input<typeof EnqueuePolicySchema> = {
  // @ts-expect-error a concurrency limit belongs
  // to the queue every item lands in, not to one
  // item's enqueue
  globalConcurrency: 4,
};

export type {};
void [
  ir,
  unknownKind,
  stepWithService,
  branchWithEmailConfig,
  edgeWithoutSource,
  halfPlaced,
  queueWithEnqueueOption,
  enqueueWithQueueOption,
];
