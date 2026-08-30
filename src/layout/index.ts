import ELK from 'elkjs';

import type { WorkflowIR } from '../ir/index.js';

import { toElkGraph } from './graph.js';

/**
 * Deterministic layout: where a workflow's nodes
 * sit on the canvas.
 *
 * Coordinates are computed from the document and
 * handed back, never written into it. The IR has
 * no coordinate fields at all, so there is nothing
 * for an agent to emit and nothing to drift out of
 * date — the price is that layout runs on every
 * render, which is why it may not read the clock,
 * the DOM, or anything else that could make two
 * runs on one document disagree.
 */

/**
 * Where one node sits and how big it is, in canvas
 * pixels.
 */
export type NodeBox = { x: number; y: number; w: number; h: number };

/**
 * Lays out a workflow, returning a box per node
 * keyed by node id. Edge routes are not returned:
 * the canvas draws its own edges, and a loop's
 * closing edge is drawn against the flow rather
 * than along the path ELK routed it.
 *
 * Async because ELK's own layout call is.
 */
export async function layout(ir: WorkflowIR): Promise<Map<string, NodeBox>> {
  // Built here rather than at module load so that
  // importing the library does not pay for the
  // layout engine, and so that no state survives
  // from one layout to the next.
  const elk = new ELK();

  const laid = await elk.layout(toElkGraph(ir));
  const boxes = new Map<string, NodeBox>();

  for (const child of laid.children ?? []) {
    // Rounded to whole pixels. Nothing consumes a
    // fraction of one, and rounding is what keeps
    // the coordinates byte-identical when the same
    // document is laid out on another machine,
    // where the last bit of a double need not
    // land the same way.
    boxes.set(child.id, {
      x: Math.round(child.x ?? 0),
      y: Math.round(child.y ?? 0),
      w: Math.round(child.width ?? 0),
      h: Math.round(child.height ?? 0),
    });
  }

  return boxes;
}

/**
 * The metrics table is part of the public surface
 * because the canvas has to draw nodes at the
 * sizes these coordinates were computed for. A
 * canvas that picked its own sizes would paint
 * boxes that do not match the layout.
 */
export {
  NODE_WIDTH,
  NODE_BASE_HEIGHT,
  CONFIG_ROW_HEIGHT,
  TITLE_MAX_CHARS,
  nodeSize,
  truncateTitle,
} from './metrics.js';
