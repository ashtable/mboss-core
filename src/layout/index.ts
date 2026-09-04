import ELK from 'elkjs';

import type { WorkflowIR, WorkflowNode } from '../ir/index.js';

import { toElkGraph } from './graph.js';
import { LOOSE_GAP, NODE_HEIGHT, nodeSize } from './metrics.js';

/**
 * Deterministic layout: where a workflow's nodes
 * sit on the canvas.
 *
 * `layout` computes every coordinate from the
 * shape of the document and hands them back,
 * never writing them into it. `place` starts from
 * the positions a person has already put there and
 * lays out only what they have not placed.
 *
 * Neither may read the clock, the DOM, or anything
 * else that could make two runs on one document
 * disagree: both run on every render, and the same
 * document has to land in the same place each
 * time.
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
 * The box a node occupies at a position it carries.
 */
function boxAt(node: WorkflowNode, x: number, y: number): NodeBox {
  const { width, height } = nodeSize(node.kind);

  return { x, y, w: width, h: height };
}

/**
 * Where each node sits, honouring the positions
 * the document carries and laying out only what it
 * does not.
 *
 * Three cases. A document nobody has placed a
 * block in is an ordinary `layout`. A document
 * where every block has been placed is its own
 * coordinates and never reaches the layout engine.
 * In between, the placed blocks stay exactly where
 * they were put and the rest are parked in a
 * column under them, in document order — an agent
 * added blocks nobody has moved yet, and this puts
 * them somewhere a person will find them rather
 * than re-arranging a layout somebody made by
 * hand.
 *
 * Nothing rounds here: a position is whole pixels
 * by the time the schema has parsed it.
 *
 * Async because the first case is `layout`.
 */
export async function place(ir: WorkflowIR): Promise<Map<string, NodeBox>> {
  const boxes = new Map<string, NodeBox>();
  const parked: WorkflowNode[] = [];

  for (const node of ir.nodes) {
    const { position } = node;

    if (position) boxes.set(node.id, boxAt(node, position.x, position.y));
    else parked.push(node);
  }

  // An empty document lands here too, and laying
  // out nothing is the right answer for it.
  if (boxes.size === 0) return layout(ir);

  const placed = [...boxes.values()];
  const left = Math.min(...placed.map((box) => box.x));
  let y = Math.max(...placed.map((box) => box.y + box.h)) + LOOSE_GAP;

  for (const node of parked) {
    boxes.set(node.id, boxAt(node, left, y));
    y += NODE_HEIGHT + LOOSE_GAP;
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
  NODE_HEIGHT,
  TITLE_MAX_CHARS,
  nodeSize,
  truncateTitle,
} from './metrics.js';
