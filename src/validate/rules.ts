import {
  portsOf,
  type BranchCase,
  type NodeKind,
  type Predicate,
  type WorkflowIR,
  type WorkflowNode,
} from '../ir/index.js';
import type { LibManifest, NonSerializableReason } from '../manifest/index.js';

import { diagnostic, warning, type Diagnostic } from './diagnostic.js';
import {
  dominators,
  isDag,
  reachableFrom,
  type WorkflowGraph,
} from './graph.js';
import {
  decisionValues,
  handlerFit,
  HANDLER_KINDS,
  type HandlerMisfit,
} from './handler-fit.js';

/**
 * The fourteen rules, one function each.
 *
 * They are separate functions rather than one pass
 * because they are read one at a time: a person
 * looking at a `V05` on their canvas should be
 * able to open one function and see the whole of
 * what that code means.
 */

/**
 * What every rule is given.
 *
 * The manifest is optional because validation runs
 * before a project has been scanned, and in tools
 * that never scan one. Without it the rules that
 * name it still check everything the document can
 * be checked against on its own — they just cannot
 * tell a name that is wrong from a name that is
 * merely new, and the two rules that read nothing
 * but the scan say nothing at all.
 */
export type RuleContext = {
  ir: WorkflowIR;
  graph: WorkflowGraph;
  manifest?: LibManifest;
};

export type Rule = (ctx: RuleContext) => Diagnostic[];

type TriggerNode = Extract<WorkflowNode, { kind: 'trigger' }>;

/**
 * The kinds that are unfinished until a handler
 * names their code.
 *
 * A branch may run code and is deliberately not
 * here: it tests the value that reached it until
 * somebody gives it a function of its own, so a
 * branch with no handler is missing nothing.
 */
const NEEDS_HANDLER: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'step',
  'transaction',
  'apiCall',
  'codeStep',
]);

function triggersOf(ir: WorkflowIR): TriggerNode[] {
  return ir.nodes.filter(
    (node): node is TriggerNode => node.kind === 'trigger',
  );
}

/**
 * Where a run starts, for the two rules that have
 * to walk the graph from somewhere.
 *
 * A document with more than one trigger is already
 * an error, so the first one is used rather than
 * every one: the author is being told to remove
 * the others, not to reason about a graph with two
 * entry points.
 */
function rootOf(ir: WorkflowIR): string | undefined {
  return triggersOf(ir)[0]?.id;
}

/**
 * Exactly one trigger, and nothing running before
 * it.
 *
 * Zero triggers is the one finding here that is
 * only a warning: a canvas is scaffolded empty and
 * an author or agent adds the trigger later, so a
 * trigger-less document has to stay saveable.
 */
export function v01TriggerShape(ctx: RuleContext): Diagnostic[] {
  const triggers = triggersOf(ctx.ir);
  const first = triggers[0];

  if (first === undefined) {
    return [
      warning(
        'V01',
        'This workflow has no trigger yet, so nothing starts a run.',
      ),
    ];
  }

  const found: Diagnostic[] = [];

  for (const extra of triggers.slice(1)) {
    found.push(
      diagnostic(
        'V01',
        `A workflow starts one way, and \`${first.id}\` already starts ` +
          `this one.`,
        { nodeId: extra.id },
      ),
    );
  }

  for (const trigger of triggers) {
    for (const edge of ctx.graph.incoming.get(trigger.id) ?? []) {
      found.push(
        diagnostic(
          'V01',
          `Nothing runs before a trigger, so no edge may point at ` +
            `\`${trigger.id}\`.`,
          { nodeId: trigger.id, edgeId: edge.id },
        ),
      );
    }
  }

  return found;
}

/**
 * The document says only things that exist: ids
 * that are not shared, edges between nodes that
 * are there, on ports those nodes actually have.
 *
 * Every rule after this one assumes it passed,
 * which is why it is the one rule that reads
 * `ir.nodes` directly instead of the graph — the
 * graph indexes nodes by id, and would quietly
 * hide the duplicate this rule exists to find.
 */
export function v02Structure(ctx: RuleContext): Diagnostic[] {
  const found: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const node of ctx.ir.nodes) {
    if (seen.has(node.id)) {
      found.push(
        diagnostic(
          'V02',
          `Two nodes are both called \`${node.id}\`. Ids name generated ` +
            `functions, so they have to be unique.`,
          { nodeId: node.id },
        ),
      );
    }

    seen.add(node.id);
  }

  for (const edge of ctx.ir.edges) {
    const from = ctx.graph.nodes.get(edge.from.node);
    const to = ctx.graph.nodes.get(edge.to.node);

    if (from === undefined) {
      found.push(danglingEnd(edge.id, edge.from.node));
    }

    if (to === undefined) {
      found.push(danglingEnd(edge.id, edge.to.node));
    }

    if (from !== undefined && !portsOf(from).includes(edge.from.port)) {
      found.push(
        diagnostic(
          'V02',
          `\`${from.id}\` has no way out called \`${edge.from.port}\`. ` +
            `It leaves by ${portsOf(from)
              .map((port) => `\`${port}\``)
              .join(', ')}.`,
          { nodeId: from.id, edgeId: edge.id },
        ),
      );
    }
  }

  return found;
}

function danglingEnd(edgeId: string, missing: string): Diagnostic {
  return diagnostic(
    'V02',
    `Edge \`${edgeId}\` names \`${missing}\`, which is not a node in this ` +
      `workflow.`,
    { edgeId },
  );
}

/**
 * Every node is on some path from the trigger.
 *
 * A warning, not an error: an island is a block an
 * author has dropped on the canvas and not wired
 * up yet. The compiler emits only what the trigger
 * reaches, so an island costs nothing but is
 * almost always a forgotten wire.
 */
export function v03Reachability(ctx: RuleContext): Diagnostic[] {
  const root = rootOf(ctx.ir);

  // With no trigger, every node is unreachable and
  // saying so eleven times would bury the one
  // finding that matters.
  if (root === undefined) return [];

  const reached = reachableFrom(ctx.graph, root);

  return ctx.ir.nodes
    .filter((node) => !reached.has(node.id))
    .map((node) =>
      diagnostic(
        'V03',
        `Nothing leads to \`${node.id}\`, so a run never gets there.`,
        { nodeId: node.id },
      ),
    );
}

/**
 * The only cycles are the ones the author declared
 * by marking an edge as loop-closing.
 *
 * An undeclared cycle has no bound and no entry
 * point, so there is nothing to compile it into.
 */
export function v04Acyclicity(ctx: RuleContext): Diagnostic[] {
  if (isDag(ctx.graph)) return [];

  return [
    diagnostic(
      'V04',
      'This workflow loops back on itself without saying so. Mark the ' +
        'edge that closes the loop as a loop edge, or remove it.',
    ),
  ];
}

/**
 * A loop-closing edge leaves a branch by one of
 * its case ports, and lands on a node that every
 * path to that branch already ran.
 *
 * Both halves are what make the compiled
 * `do/while` well defined: the branch supplies the
 * condition and the iteration bound, and a target
 * that dominates the branch is a point the run was
 * always going to be at, so re-entering there
 * cannot skip work or repeat work the run never
 * did.
 */
export function v05BackEdges(ctx: RuleContext): Diagnostic[] {
  const closing = ctx.ir.edges.filter((edge) => edge.back);
  if (closing.length === 0) return [];

  const root = rootOf(ctx.ir);
  const doms = root === undefined ? undefined : dominators(ctx.graph, root);
  const found: Diagnostic[] = [];

  for (const edge of closing) {
    const from = ctx.graph.nodes.get(edge.from.node);

    // A dangling edge is V02's finding to report.
    if (from === undefined) continue;

    const isCasePort =
      from.kind === 'branch' &&
      from.config.cases.some((each) => each.port === edge.from.port);

    if (!isCasePort) {
      found.push(
        diagnostic(
          'V05',
          `A loop edge leaves a branch by one of its case ports, because ` +
            `that case is what decides whether the loop goes round again. ` +
            `\`${edge.from.node}\` has no such port.`,
          { nodeId: from.id, edgeId: edge.id },
        ),
      );
      continue;
    }

    if (doms === undefined) continue;

    const passedThrough = doms.get(from.id);

    // A branch no run reaches has no dominators
    // rather than too few: an island being wired up
    // is what V03 reports, and there is nothing
    // true to say here about a run that never
    // arrives.
    if (passedThrough === undefined) continue;

    if (!passedThrough.has(edge.to.node)) {
      found.push(
        diagnostic(
          'V05',
          `A run can reach \`${from.id}\` without passing through ` +
            `\`${edge.to.node}\`, so looping back there would restart the ` +
            `run at a step it may never have taken.`,
          { nodeId: from.id, edgeId: edge.id },
        ),
      );
    }
  }

  return found;
}

/**
 * An edge's type agrees with what its ends
 * declare, and names a type the code-behind
 * exports.
 *
 * A node that declares nothing is undeclared, not
 * lying: a branch says what it takes in and
 * nothing about what leaves it, and the canonical
 * workflow's branches carry typed edges out. So
 * each end is checked only where it made a claim.
 */
export function v06EdgeTypes(ctx: RuleContext): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const edge of ctx.ir.edges) {
    const producer = ctx.graph.nodes.get(edge.from.node);
    const consumer = ctx.graph.nodes.get(edge.to.node);
    const edgeType = edge.type;

    // A wire carries a type whether or not it names
    // one, and here both ends have already said
    // what that type is. Leaving the wire
    // undeclared does not settle a disagreement
    // between them.
    if (edgeType === undefined) {
      if (
        producer?.out !== undefined &&
        consumer?.in !== undefined &&
        producer.out !== consumer.in
      ) {
        found.push(
          diagnostic(
            'V06',
            `\`${producer.id}\` produces \`${producer.out}\`, but ` +
              `\`${consumer.id}\` takes \`${consumer.in}\`.`,
            { nodeId: consumer.id, edgeId: edge.id },
          ),
        );
      }

      continue;
    }

    if (producer?.out !== undefined && producer.out !== edgeType) {
      found.push(
        diagnostic(
          'V06',
          `\`${producer.id}\` produces \`${producer.out}\`, but this wire ` +
            `carries \`${edgeType}\`.`,
          { nodeId: producer.id, edgeId: edge.id },
        ),
      );
    }

    if (consumer?.in !== undefined && consumer.in !== edgeType) {
      found.push(
        diagnostic(
          'V06',
          `\`${consumer.id}\` takes \`${consumer.in}\`, but this wire ` +
            `carries \`${edgeType}\`.`,
          { nodeId: consumer.id, edgeId: edge.id },
        ),
      );
    }

    if (ctx.manifest !== undefined && !ctx.manifest.types.includes(edgeType)) {
      found.push(
        diagnostic(
          'V06',
          `The code-behind exports no type called \`${edgeType}\`.`,
          { edgeId: edge.id },
        ),
      );
    }
  }

  return found;
}

/**
 * The kinds that run code name a handler, and the
 * code-behind exports it.
 *
 * A warning, because creating the block before the
 * code behind it is the normal way to work: the
 * canvas scaffolds a stub from the block's
 * declared types. Compilation is where a missing
 * handler becomes fatal, since there is nothing to
 * call.
 *
 * The two findings run over different sets of
 * kinds. Every kind that can name a function is
 * held to naming one that exists, a branch
 * included; only the kinds that are nothing without
 * code are told they have none yet.
 */
export function v07Handlers(ctx: RuleContext): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const node of ctx.ir.nodes) {
    const handler = node.handler;

    if (handler === undefined) {
      if (NEEDS_HANDLER.has(node.kind)) {
        found.push(
          diagnostic('V07', `\`${node.id}\` has no handler yet.`, {
            nodeId: node.id,
          }),
        );
      }

      continue;
    }

    if (!HANDLER_KINDS.has(node.kind)) continue;
    if (ctx.manifest === undefined) continue;

    const exists = ctx.manifest.functions.some(
      (fn) => fn.export === handler.export,
    );

    if (!exists) {
      found.push(
        diagnostic(
          'V07',
          `\`${node.id}\` runs \`${handler.export}\`, which the code-behind ` +
            `does not export yet.`,
          { nodeId: node.id },
        ),
      );
    }
  }

  return found;
}

/**
 * A loop's body is one contiguous chain, entered
 * at its first member and left from its last.
 *
 * The compiler emits the body as a sequence inside
 * one repeat, so anything that reaches into the
 * middle of it, or leaves from the middle of it,
 * would compile into code that does not do what
 * the canvas draws.
 *
 * At most one finding per loop: the first thing
 * wrong with a body usually explains the rest.
 */
export function v08LoopBodies(ctx: RuleContext): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const node of ctx.ir.nodes) {
    if (node.kind !== 'loop') continue;

    const problem = loopBodyProblem(ctx, node.config.body);

    if (problem !== undefined) {
      found.push(diagnostic('V08', problem, { nodeId: node.id }));
    }
  }

  return found;
}

/**
 * The first thing wrong with a loop's body, or
 * `undefined` if it is one clean chain.
 */
function loopBodyProblem(
  ctx: RuleContext,
  body: readonly string[],
): string | undefined {
  const first = body.at(0);
  const last = body.at(-1);

  if (first === undefined || last === undefined) {
    return 'This loop has no body, so there is nothing to repeat.';
  }

  const missing = body.find((id) => !ctx.graph.nodes.has(id));
  if (missing !== undefined) {
    return `This loop repeats \`${missing}\`, which is not a node in this workflow.`;
  }

  const members = new Set(body);
  const links = new Set<string>();

  for (const [index, id] of body.slice(0, -1).entries()) {
    const next = body[index + 1];
    if (next === undefined) continue;

    const joined = (ctx.graph.outgoing.get(id) ?? []).some(
      (edge) => edge.to.node === next,
    );

    if (!joined) {
      return `This loop repeats \`${id}\` then \`${next}\`, but no edge joins them.`;
    }

    links.add(linkKey(id, next));
  }

  for (const id of body) {
    for (const edge of ctx.graph.outgoing.get(id) ?? []) {
      if (members.has(edge.to.node) && !links.has(linkKey(id, edge.to.node))) {
        return (
          `\`${id}\` skips ahead to \`${edge.to.node}\` inside the loop. ` +
          `A body runs in order, one member after the next.`
        );
      }
    }
  }

  const inbound = ctx.ir.edges.filter(
    (edge) => members.has(edge.to.node) && !members.has(edge.from.node),
  );

  if (inbound.length > 1 || inbound.some((edge) => edge.to.node !== first)) {
    return `A run enters this loop at \`${first}\` and nowhere else.`;
  }

  const outbound = ctx.ir.edges.filter(
    (edge) => members.has(edge.from.node) && !members.has(edge.to.node),
  );

  if (outbound.length > 1 || outbound.some((edge) => edge.from.node !== last)) {
    return `A run leaves this loop from \`${last}\` and nowhere else.`;
  }

  return undefined;
}

/**
 * A pair of ids as one key. Ids are slugs and
 * cannot contain a space, so the join is
 * unambiguous.
 */
function linkKey(from: string, to: string): string {
  return `${from} ${to}`;
}

/**
 * A wait for a form waits on an email that
 * actually carries one.
 *
 * The form's link is minted by the email that
 * sends it and scoped to the waiting node, so a
 * wait pointing at an email with nothing to fill
 * in is a run that parks forever.
 */
export function v09FormWaits(ctx: RuleContext): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const node of ctx.ir.nodes) {
    if (node.kind !== 'durableWait') continue;

    const source = node.config.source;
    if (source.kind !== 'form') continue;

    const email = ctx.graph.nodes.get(source.email);
    const problem = formSourceProblem(source.email, email);

    if (problem !== undefined) {
      found.push(diagnostic('V09', problem, { nodeId: node.id }));
    }
  }

  return found;
}

function formSourceProblem(
  id: string,
  email: WorkflowNode | undefined,
): string | undefined {
  if (email === undefined) {
    return `This wait is for an answer from \`${id}\`, which is not a node in this workflow.`;
  }

  if (email.kind !== 'emailSend') {
    return `This wait is for a form sent by \`${id}\`, which is not an email.`;
  }

  if (email.config.attach.type !== 'form') {
    return `This wait is for a form sent by \`${id}\`, but that email carries no form to fill in.`;
  }

  return undefined;
}

/**
 * Whoever reads a guarded node's output either
 * does not require an input, or is skipped under
 * the same condition.
 *
 * A guard that is false means the node does not
 * run and produces nothing. A consumer that
 * declares an input it will not get is a type lie
 * the canvas would draw as a clean typed wire, so
 * it is rejected where it is written rather than
 * discovered at run time as an undefined.
 */
export function v10GuardedConsumers(ctx: RuleContext): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const node of ctx.ir.nodes) {
    const guard = node.guard;
    if (guard === undefined) continue;

    for (const edge of ctx.graph.outgoing.get(node.id) ?? []) {
      const consumer = ctx.graph.nodes.get(edge.to.node);

      if (consumer === undefined || consumer.in === undefined) continue;
      if (sameGuard(consumer.guard, guard)) continue;

      found.push(
        diagnostic(
          'V10',
          `\`${node.id}\` is skipped when its condition is false, so ` +
            `\`${consumer.id}\` would get nothing. Give it the same ` +
            `condition, or stop it requiring an input.`,
          { nodeId: consumer.id, edgeId: edge.id },
        ),
      );
    }
  }

  return found;
}

export function sameGuard(a?: Predicate, b?: Predicate): boolean {
  if (a === undefined || b === undefined) return a === b;

  return (
    a.path === b.path &&
    a.op === b.op &&
    JSON.stringify(a.value ?? null) === JSON.stringify(b.value ?? null)
  );
}

/**
 * Mail to the requesting user only where there is
 * a requesting user to find.
 *
 * The address is read at run time out of the event
 * that started the run, by the path the trigger
 * declares. A manual or scheduled run has no such
 * event, and an event trigger that declares no
 * path has nowhere to read it from.
 *
 * A draft with no trigger yet is left alone, the
 * way V03 and V05 leave it alone: adding the
 * trigger last is an ordinary order of work, and
 * this rule's error would stop that draft being
 * saved over a trigger that is not there to be
 * wrong. V01's warning is the finding that fits.
 */
export function v11RequesterAddress(ctx: RuleContext): Diagnostic[] {
  const trigger = triggersOf(ctx.ir)[0];
  if (trigger === undefined) return [];

  const declared =
    trigger.config.mode === 'event' &&
    trigger.config.requesterEmailPath !== undefined;

  if (declared) return [];

  return ctx.ir.nodes
    .filter((node) => recipientOf(node) === 'requestingUser')
    .map((node) =>
      diagnostic(
        'V11',
        `\`${node.id}\` writes to whoever asked for this run, but the ` +
          `trigger does not say where to find their address.`,
        { nodeId: node.id },
      ),
    );
}

function recipientOf(node: WorkflowNode): string | undefined {
  if (node.kind === 'emailSend' || node.kind === 'approval') {
    return node.config.to;
  }

  return undefined;
}

/**
 * What a member is, said the way the message needs
 * it.
 */
const CANNOT_TRAVEL: Record<NonSerializableReason, string> = {
  function: 'is a function',
  class: 'is a class with methods',
  buffer: 'is a Buffer',
  stream: 'is a stream',
  handle: 'is an open connection',
};

/**
 * What a node declares can survive the trip
 * between two blocks.
 *
 * Values move from block to block through the
 * workflow database, so a type carrying behaviour
 * or a live resource — a callback, a class's
 * methods, a buffer, a stream, an open connection
 * — arrives at the far end as something else. The
 * scan works this out while it still has the
 * parsed code; by the time the manifest is read
 * back out of JSON there is nothing left but
 * names, which is why the finding is carried
 * rather than recomputed.
 *
 * Silent without a manifest, like every rule that
 * reads one: nothing scanned is not the same
 * answer as nothing wrong.
 */
export function v12SerializableTypes(ctx: RuleContext): Diagnostic[] {
  const manifest = ctx.manifest;
  if (manifest === undefined) return [];

  const found: Diagnostic[] = [];

  for (const node of ctx.ir.nodes) {
    for (const [verb, declared] of [
      ['takes', node.in],
      ['produces', node.out],
    ] as const) {
      if (declared === undefined) continue;

      for (const fault of manifest.nonSerializable) {
        if (fault.type !== declared) continue;

        const where =
          fault.path === '' ? declared : `${declared}.${fault.path}`;

        found.push(
          diagnostic(
            'V12',
            `\`${node.id}\` ${verb} \`${declared}\`, and \`${where}\` ` +
              `${CANNOT_TRAVEL[fault.reason]}. Values are written to the ` +
              `database between blocks, so only data survives the trip.`,
            { nodeId: node.id },
          ),
        );
      }
    }
  }

  return found;
}

/**
 * A node's declared types are the ones its code
 * actually takes and returns.
 *
 * The canvas will wire anything to anything, so
 * this is the likeliest thing to get wrong in the
 * whole system. Without the rule it surfaces as a
 * TypeScript error inside a generated file the
 * author cannot edit; with it, it is a finding on
 * the block that says it.
 *
 * The comparison is `handlerFit`'s, so a function
 * the picker offers is never one this rule then
 * rejects. Only the two misfits about declared
 * types are reported. A handler on a kind that
 * runs none is dropped by the emitter and never
 * offered in the first place. A return type
 * nothing can be a case of is about a branch's
 * cases rather than about a signature. And a
 * function taking more than one value is already
 * refused at the picker, at the drop target and by
 * the generated code's own type-check — saying it
 * a fourth time, off a cache that may have
 * recorded nothing about which parameters a call
 * can leave out, would put an error on a handler
 * that compiles.
 *
 * It stays quiet wherever it cannot know: with no
 * scan, with no handler, and with a handler the
 * scan never saw, which is V07's to report.
 */
export function v13HandlerSignatures(ctx: RuleContext): Diagnostic[] {
  const manifest = ctx.manifest;
  if (manifest === undefined) return [];

  const found: Diagnostic[] = [];

  for (const node of ctx.ir.nodes) {
    const handler = node.handler;
    if (handler === undefined) continue;

    const fn = manifest.functions.find(
      (each) => each.export === handler.export,
    );
    if (fn === undefined) continue;

    const fit = handlerFit(node, fn);
    if (fit.fits) continue;

    const message = mismatchMessage(node.id, fn.export, fit.reason);

    if (message !== undefined) {
      found.push(diagnostic('V13', message, { nodeId: node.id }));
    }
  }

  return found;
}

/**
 * What to tell an author about a misfit, or
 * `undefined` for the three this rule leaves to
 * somebody else.
 */
function mismatchMessage(
  nodeId: string,
  handler: string,
  reason: HandlerMisfit,
): string | undefined {
  switch (reason.kind) {
    case 'input-mismatch':
      return (
        `\`${nodeId}\` takes \`${reason.declared}\`, but its code-behind ` +
        `\`${handler}\` takes \`${reason.takes}\`. The generated code ` +
        `would hand it the wrong value.`
      );

    case 'output-mismatch':
      return (
        `\`${nodeId}\` produces \`${reason.declared}\`, but its code-behind ` +
        `\`${handler}\` returns \`${reason.returns}\`. The generated code ` +
        `would pass on the wrong value.`
      );

    default:
      return undefined;
  }
}

/**
 * A branch that runs code has one case per answer
 * that code can give.
 *
 * A branch with a handler is a decision: the
 * function runs as a step of its own and the cases
 * match what it returned. So a case here names one
 * whole answer, where a branch without a handler
 * reads a field out of the value that reached it.
 * A case still shaped like a predicate is one
 * written before the branch was given code, and it
 * would compile into a test against something the
 * decision is not.
 *
 * With a scan to read, the answers themselves are
 * known: the function has to decide between values
 * a case can name, every one of those values needs
 * a case, and a case naming an answer the function
 * never gives is a way out no run takes.
 *
 * The fall-through port is deliberately not
 * required to be wired. Cases that cover every
 * answer leave nothing to fall through to, and the
 * arm compiles to a `return`, which is the right
 * thing to do about a value the type said could
 * not happen.
 */
export function v14DecisionBranches(ctx: RuleContext): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const node of ctx.ir.nodes) {
    if (node.kind !== 'branch') continue;

    const handler = node.handler?.export;
    if (handler === undefined) continue;

    const site = { nodeId: node.id };
    const fn = ctx.manifest?.functions.find((each) => each.export === handler);

    // No scan, or a handler the scan never saw —
    // which is V07's finding — leaves the cases to
    // be read on their own.
    const answers = fn === undefined ? undefined : decisionValues(fn);

    if (fn !== undefined && answers === undefined) {
      found.push(
        diagnostic(
          'V14',
          `\`${node.id}\` runs \`${handler}\`, which returns ` +
            `\`${fn.returnType}\`. A branch's cases match what its code ` +
            `decided, so that code returns a boolean or one of a set of ` +
            `strings.`,
          site,
        ),
      );
    }

    for (const branchCase of node.config.cases) {
      const problem = decisionCaseProblem(
        node.id,
        handler,
        branchCase,
        answers,
      );

      if (problem !== undefined) {
        found.push(diagnostic('V14', problem, site));
      }
    }

    for (const answer of answers ?? []) {
      // What a case matches is what makes it that
      // answer's way out. A case reading a path or
      // comparing with something other than `eq` is
      // already reported above, and telling an
      // author to add a second case for the answer
      // it names would send them the wrong way.
      const answered = node.config.cases.some(
        (each) => each.when.value === answer,
      );

      if (answered) continue;

      found.push(
        diagnostic(
          'V14',
          `\`${handler}\` can decide \`${shown(answer)}\`, and ` +
            `\`${node.id}\` has no case for it. Add one, so every answer ` +
            `has a way out.`,
          site,
        ),
      );
    }
  }

  return found;
}

/**
 * The first thing wrong with one case of a decision
 * branch, or `undefined`. `answers` is what the
 * handler decides between, or `undefined` wherever
 * nothing has read it.
 */
function decisionCaseProblem(
  nodeId: string,
  handler: string,
  branchCase: BranchCase,
  answers: readonly (string | boolean)[] | undefined,
): string | undefined {
  const when = branchCase.when;

  if (when.path !== '') {
    return (
      `\`${nodeId}\` runs \`${handler}\`, so its cases match what that ` +
      `decided. The \`${branchCase.port}\` case reads \`${when.path}\` out ` +
      `of the answer instead.`
    );
  }

  if (when.op !== 'eq') {
    return (
      `\`${nodeId}\` runs \`${handler}\`, so its cases match one answer ` +
      `each. The \`${branchCase.port}\` case compares with \`${when.op}\` ` +
      `instead.`
    );
  }

  if (
    answers !== undefined &&
    !answers.some((answer) => answer === when.value)
  ) {
    return (
      `\`${nodeId}\` has a case for \`${shown(when.value)}\`, which ` +
      `\`${handler}\` never decides. It decides ` +
      `${answers.map((answer) => `\`${shown(answer)}\``).join(', ')}.`
    );
  }

  return undefined;
}

/**
 * An answer as the document writes it, so a string
 * reads as a string and `true` as a boolean.
 */
function shown(value: unknown): string {
  return JSON.stringify(value) ?? 'nothing';
}

/**
 * Every rule, in code order. The order is the
 * order findings come back in, so a document with
 * several problems reports them the same way every
 * time.
 */
export const RULES: readonly Rule[] = [
  v01TriggerShape,
  v02Structure,
  v03Reachability,
  v04Acyclicity,
  v05BackEdges,
  v06EdgeTypes,
  v07Handlers,
  v08LoopBodies,
  v09FormWaits,
  v10GuardedConsumers,
  v11RequesterAddress,
  v12SerializableTypes,
  v13HandlerSignatures,
  v14DecisionBranches,
];
