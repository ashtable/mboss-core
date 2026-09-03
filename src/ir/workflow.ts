import { z } from 'zod';

import { NodeSchema } from './catalog.js';
import { EdgeSchema, WorkflowNameSchema } from './types.js';

/**
 * One workflow document, as it sits on disk in
 * `.mboss/workflows/<name>.workflow.json`.
 *
 * A node's `position` is optional, and it is a
 * person's to set by moving a block; a node
 * without one is laid out from the graph at
 * render time. Anything that does not know about
 * coordinates leaves the ones it reads alone, so
 * what is on disk is a person's arrangement or
 * nothing at all.
 *
 * `revision` counts edits and only ever goes up,
 * including through an undo. Two writers holding
 * the same revision is how a conflicting edit is
 * caught rather than silently overwritten.
 */
export const WorkflowIRSchema = z.object({
  $schema: z.literal('https://mboss.dev/schemas/workflow-v1.json'),
  version: z.literal(1),
  revision: z.number().int().min(1),
  name: WorkflowNameSchema,
  title: z.string().optional(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

export type WorkflowIR = z.infer<typeof WorkflowIRSchema>;
