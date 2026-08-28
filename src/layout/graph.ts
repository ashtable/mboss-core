import type { ElkExtendedEdge, ElkNode } from 'elkjs';

import { portsOf, type WorkflowIR, type WorkflowNode } from '../ir/index.js';

import { nodeSize } from './metrics.js';
import { LAYOUT_OPTIONS } from './options.js';

/**
 * Sorts by id on code units rather than by locale.
 * The sort is what makes layout independent of the
 * order a document happens to list its nodes and
 * edges in, so it has to order the same way on
 * every machine that runs it, and `localeCompare`
 * does not.
 */
function byId(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1;

  return a.id > b.id ? 1 : 0;
}

/**
 * ELK resolves an edge endpoint by id against one
 * flat namespace of shapes, so a port's id has to
 * carry the node it belongs to.
 */
function portId(nodeId: string, port: string): string {
  return `${nodeId}.${port}`;
}

/**
 * Only a node with more than one way out needs
 * ports. Every other node's edges attach to the
 * node itself, which keeps the graph — and the
 * goldens built from it — free of ports that exist
 * only to say "the usual way out".
 */
function toElkChild(node: WorkflowNode): ElkNode {
  const { width, height } = nodeSize(node.kind);
  const ports = portsOf(node);

  if (ports.length === 1) return { id: node.id, width, height };

  return {
    id: node.id,
    width,
    height,
    ports: ports.map((port) => ({ id: portId(node.id, port) })),
  };
}

/**
 * The ELK input graph for a workflow document.
 *
 * Nodes and edges are sorted by id first: ELK is
 * asked to respect the order it is given, so
 * without a canonical sort the coordinates would
 * depend on the order the JSON on disk happens to
 * list things in, and reordering two untouched
 * nodes would move the whole canvas.
 *
 * Loop-closing edges go in reversed. Handed to ELK
 * the way they are drawn they would pull their
 * target down past their source and flatten the
 * loop into a straight run; reversed, the loop's
 * members keep the layer order the workflow
 * actually executes in.
 */
export function toElkGraph(ir: WorkflowIR): ElkNode {
  const children = [...ir.nodes].sort(byId).map(toElkChild);

  // Taken from what was emitted rather than
  // recomputed, so an edge can never name a port
  // the graph does not carry.
  const declaredPorts = new Set(
    children.flatMap((child) => (child.ports ?? []).map((port) => port.id)),
  );

  const edges: ElkExtendedEdge[] = [...ir.edges].sort(byId).map((edge) => {
    const fromPort = portId(edge.from.node, edge.from.port);
    const from = declaredPorts.has(fromPort) ? fromPort : edge.from.node;
    const to = edge.to.node;

    return edge.back
      ? { id: edge.id, sources: [to], targets: [from] }
      : { id: edge.id, sources: [from], targets: [to] };
  });

  return { id: 'root', layoutOptions: { ...LAYOUT_OPTIONS }, children, edges };
}
