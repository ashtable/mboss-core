import { z } from 'zod';

import { NodeSchema } from './catalog.js';
import { EdgeSchema, WorkflowNameSchema } from './types.js';

/**
 * One workflow document, as it sits on disk in
 * `.mboss/workflows/<name>.workflow.json`.
 *
 * It has no coordinate fields anywhere, and that
 * is the point: layout is recomputed from the
 * graph at render time, so there is nothing here
 * for an agent to emit and nothing to drift out
 * of date.
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
