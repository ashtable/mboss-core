import type { z } from 'zod';

import { NodeSchema, WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';

/**
 * Builds small Workflow IR documents for tests.
 *
 * Everything it produces goes through the real
 * schema, so a test can never pass against a
 * document that could not exist on disk. The
 * defaults it fills in — kind `step`, an empty
 * config, the title taken from the id — are the
 * parts a rule under test almost never cares
 * about.
 */

/**
 * A node with only the fields the test is about.
 * The schema's input type is used rather than its
 * output type so a test may leave out fields that
 * carry a default.
 */
export type NodeSpec = Partial<z.input<typeof NodeSchema>> & { id: string };

/**
 * An edge written the way a test reads it:
 * `{ from: 'slot_open', port: 'no', to: 'twilio_chat' }`.
 * Ids are numbered in order unless the test needs
 * to name one.
 */
export type EdgeSpec = {
  id?: string;
  from: string;
  port?: string;
  to: string;
  type?: string;
  back?: boolean;
};

export function makeIR(parts: {
  /** Defaults to `test_workflow`. Named when the
   *  document's own name is what the test is
   *  about — a compiled file carries it in its
   *  header, its function and its registration. */
  name?: string;
  title?: string;
  nodes?: readonly NodeSpec[];
  edges?: readonly EdgeSpec[];
}): WorkflowIR {
  const nodes = (parts.nodes ?? []).map((node) => ({
    kind: 'step',
    title: node.id,
    config: {},
    ...node,
  }));

  const edges = (parts.edges ?? []).map((edge, index) => ({
    id: edge.id ?? `e${index + 1}`,
    from: { node: edge.from, port: edge.port ?? 'out' },
    to: { node: edge.to },
    ...(edge.type === undefined ? {} : { type: edge.type }),
    back: edge.back ?? false,
  }));

  return WorkflowIRSchema.parse({
    $schema: 'https://mboss.dev/schemas/workflow-v1.json',
    version: 1,
    revision: 1,
    name: parts.name ?? 'test_workflow',
    ...(parts.title === undefined ? {} : { title: parts.title }),
    nodes,
    edges,
  });
}
