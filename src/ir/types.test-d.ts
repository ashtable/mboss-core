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
import type {
  Position,
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
  // @ts-expect-error queues were considered and
  // left out; the catalog is the whole list
  kind: 'queue',
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

export type {};
void [
  ir,
  unknownKind,
  stepWithService,
  branchWithEmailConfig,
  edgeWithoutSource,
  halfPlaced,
];
