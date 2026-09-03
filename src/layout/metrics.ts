import type { NodeKind } from '../ir/catalog.js';

/**
 * The fixed geometry every node is drawn and laid
 * out with.
 *
 * Sizes come from this table and are never
 * measured. Measuring text would make the same
 * workflow lay out one way inside the extension's
 * webview and another way in Node, which is
 * exactly the drift that layout being a pure
 * function of the IR is meant to rule out.
 *
 * The canvas has to draw nodes at these sizes
 * rather than pick its own, or the boxes it paints
 * will not be the boxes the coordinates were
 * computed for.
 *
 * Every constant in this file feeds the blessed
 * layout goldens, so changing any one of them
 * moves every coordinate and means re-blessing
 * them.
 */

/**
 * One width for every kind, because nodes stack
 * into columns and a column of ragged widths reads
 * as noise rather than as structure.
 */
export const NODE_WIDTH = 230;

/**
 * One height for every kind too. A node draws an
 * icon, a title and a single line of mono,
 * whatever it does, so there is nothing left for a
 * kind to make room for.
 */
export const NODE_HEIGHT = 60;

/**
 * The gap between two nodes that were not laid out
 * against each other — the column `place` parks
 * unplaced blocks in.
 *
 * It matches the space the layout engine leaves
 * between two layers, so a parked column reads at
 * the same rhythm as an arranged one.
 */
export const LOOSE_GAP = 72;

/**
 * How much of a title a node shows. Titles are
 * free text, so without a cap one long title would
 * be the only thing setting the width of every
 * node on the canvas.
 */
export const TITLE_MAX_CHARS = 32;

/**
 * The box a node of this kind occupies. This is
 * the only size layout ever uses, so two runs on
 * the same IR start from the same boxes.
 *
 * Every kind gets the same box. The parameter
 * stays because a caller has a node in hand and
 * asks the metrics table how big to draw it, and
 * because this is where a kind would get its own
 * size back if one ever earned it.
 */
export function nodeSize(_kind: NodeKind): {
  width: number;
  height: number;
} {
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

/**
 * The title as a node shows it.
 *
 * It cuts on whole characters rather than on code
 * units, so a title ending in an emoji loses the
 * emoji instead of half of it.
 */
export function truncateTitle(title: string): string {
  const characters = [...title];
  if (characters.length <= TITLE_MAX_CHARS) return title;

  return `${characters.slice(0, TITLE_MAX_CHARS - 1).join('')}…`;
}
