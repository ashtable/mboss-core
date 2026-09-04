import {
  portsOf,
  bindsValue,
  buildGraph,
  forwardFrom,
  joinOf,
  producers,
  reachableFrom,
  sameGuard,
  topologicalOrder,
  type NodeKind,
  type Predicate,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowIR,
  type WorkflowNode,
} from '../ir/index.js';

import { UnsupportedIR } from './unsupported.js';

/**
 * The order a workflow's blocks run in, and where
 * each one gets its input.
 *
 * Emission asks two questions of the graph — what
 * comes next, and whose value does this block
 * read — and both are answered here, once, before
 * a line is written. Answering them while writing
 * would mean a code emitter that also walks a
 * graph, which is how the order codegen produces
 * comes to differ from the order validation
 * checked.
 *
 * What comes back is a tree rather than a list,
 * because control flow is a tree: a branch's arms
 * and a loop's body are regions of their own, and
 * a block inside one is in scope there and nowhere
 * else.
 */

/** What the workflow is entered through. */
export type TriggerNode = Extract<WorkflowNode, { kind: 'trigger' }>;

/**
 * A maximal run of consecutive blocks carrying the
 * same condition.
 *
 * One `if` per run rather than one per block: a
 * value bound inside one `if` does not narrow
 * inside a second `if` testing the same thing, so
 * a chain emitted block by block would be rejected
 * at its own second block.
 */
export type GuardGroup = {
  guard: Predicate | undefined;
  nodes: readonly WorkflowNode[];
};

/** Where one way out of a branch leads. */
export type ArmTarget =
  /** Nothing is wired here, so the run stops. */
  | { kind: 'end' }
  /** Round again: this is the loop-closing wire. */
  | { kind: 'again' }
  /** Out of the loop, to what follows it. */
  | { kind: 'leave' }
  /** Straight to where the arms meet again. */
  | { kind: 'join' }
  /** Its own stretch of blocks. */
  | { kind: 'region'; region: PlanRegion; outcome: RegionOutcome };

/**
 * What happens at the end of a stretch of blocks:
 * a run carries on at where the stretch stops, or
 * the last block is wired to nothing, or every way
 * out of it has already gone somewhere else.
 */
export type RegionOutcome = 'reached' | 'ranOut' | 'jumped';

export type PlanArm = {
  port: string;
  /** Absent on the way out a run takes when no
   *  case matched. */
  when?: Predicate;
  target: ArmTarget;
};

export type PlanItem =
  | { kind: 'blocks'; group: GuardGroup }
  | { kind: 'branch'; node: WorkflowNode; arms: readonly PlanArm[] }
  /**
   * An approval: an email, a wait and a two-way
   * decision, drawn as one block and emitted as
   * all three. `downstream` is what the person who
   * answered is told happens next, which starts
   * where the two arms meet again — the blocks on
   * the arm they did not take are not that.
   */
  | {
      kind: 'approval';
      node: WorkflowNode;
      arms: readonly PlanArm[];
      downstream: readonly string[];
    }
  | {
      kind: 'countedLoop';
      node: WorkflowNode;
      rounds: number;
      carried: readonly WorkflowNode[];
      body: PlanRegion;
    }
  | {
      kind: 'repeat';
      entry: WorkflowNode;
      /** The branch whose case wires back, and the
       *  case it wires back by. */
      branch: WorkflowNode;
      port: string;
      rounds: number;
      onExhausted: 'abort' | 'continue';
      carried: readonly WorkflowNode[];
      body: PlanRegion;
    };

export type PlanRegion = readonly PlanItem[];

export type EmissionPlan = {
  trigger: TriggerNode;
  /**
   * Every block that runs, in an order where
   * nothing comes before what it reads.
   *
   * Only what the trigger can reach: an island is
   * a legal draft, and emitting one would produce
   * references to values nothing assigns.
   */
  chain: readonly WorkflowNode[];
  /** Which block's value each block reads. The
   *  trigger is a producer like any other. */
  producers: ReadonlyMap<string, string>;
  /**
   * What the page a person lands on after a block
   * tells them happens next: the titles of the
   * work still to come, in the order it runs.
   */
  downstream: ReadonlyMap<string, readonly string[]>;
  /**
   * For each email carrying a form, the wait that
   * form's answers wake.
   *
   * The edge is declared the other way round — a
   * wait names its email — and the token an email
   * mints has to be scoped to the wait, so this is
   * the one place the graph is walked backwards.
   */
  waitForEmail: ReadonlyMap<string, string>;
  /** The whole body, as nested regions. */
  region: PlanRegion;
};

/**
 * The kinds a person would call work, which is
 * what a page listing "what happens next" shows.
 * A branch and a loop choose a way rather than do
 * anything, so neither is on a chip strip.
 */
const WORK_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'step',
  'codeStep',
  'apiCall',
  'transaction',
  'durableWait',
  'approval',
  'emailSend',
]);

/**
 * What one way out of an approval tests.
 *
 * The runtime sends `{ approved: boolean }` back,
 * so the decision reads like any other predicate
 * over the value a block bound — which is what
 * lets the two arms go through the same layout a
 * branch's do.
 */
const APPROVED: Predicate = { path: 'approved', op: 'eq', value: true };

/** A loop drawn as a wire back to an earlier
 *  block, with everything the compiler needs to
 *  emit it. */
type LoopRegion = {
  entry: string;
  branch: WorkflowNode;
  port: string;
  members: ReadonlySet<string>;
  /** The one block a run leaves the loop for. */
  exit: string | undefined;
  rounds: number;
  onExhausted: 'abort' | 'continue';
};

export function planWorkflow(ir: WorkflowIR): EmissionPlan {
  return new Planner(ir).plan();
}

class Planner {
  readonly #ir: WorkflowIR;
  readonly #graph: WorkflowGraph;
  readonly #trigger: TriggerNode;
  readonly #order: readonly string[];
  readonly #position = new Map<string, number>();
  readonly #producers = new Map<string, string>();
  readonly #loops = new Map<string, LoopRegion>();
  readonly #claimed = new Set<string>();

  constructor(ir: WorkflowIR) {
    this.#ir = ir;
    this.#graph = buildGraph(ir);

    const trigger = ir.nodes.find(
      (node): node is TriggerNode => node.kind === 'trigger',
    );

    if (trigger === undefined) {
      throw new UnsupportedIR(
        'this workflow has no trigger, so it never runs.',
      );
    }

    this.#trigger = trigger;
    this.#order = topologicalOrder(this.#graph, trigger.id);
    this.#order.forEach((id, index) => this.#position.set(id, index));
  }

  plan(): EmissionPlan {
    const chain = this.#order
      .map((id) => this.#graph.nodes.get(id))
      .filter((node): node is WorkflowNode => node !== undefined)
      .filter((node) => node.id !== this.#trigger.id);

    for (const [id, producer] of producers(this.#ir)) {
      this.#producers.set(id, producer);
    }

    for (const node of chain) {
      if (node.in !== undefined) {
        this.#checkWaysInAgree(node, this.#dominatingProducer(node.id));
      }
    }

    this.#findLoops();

    const first = this.#next(this.#trigger.id);
    const region = this.#walk(first, undefined, undefined).items;

    this.#checkNothingStranded();

    return {
      trigger: this.#trigger,
      chain,
      producers: this.#producers,
      downstream: this.#downstream(),
      waitForEmail: this.#waitForEmail(chain),
      region,
    };
  }

  /** The block whose value another block reads,
   *  once the ways into it have been shown to
   *  agree on which block that is. */

  /**
   * The nearest block above one that every run
   * passes through and that binds a value.
   *
   * It has to be one every run passes through: a
   * block reachable down only one arm of a branch
   * has not run when the other arm was taken, and a
   * reference to what it bound would be a
   * reference to nothing.
   */
  #dominatingProducer(id: string): string {
    return this.#producers.get(id) ?? this.#trigger.id;
  }

  /**
   * Every way into a block that reads a value
   * arrives carrying the same one.
   *
   * A way in from a block that binds a value
   * carries that value. A way in from a branch
   * carries whatever was already flowing, which is
   * the value above. When the ways in name two
   * different blocks, the drawing says this one
   * reads one thing down one route and something
   * else down another, and a compiler binding one
   * name per block would have to pick.
   *
   * Picking quietly is the worst of the options.
   * Where the two differ in type the generated file
   * does not compile, which at least says
   * something; where they agree it runs on the
   * value from before the branch and nothing
   * anywhere reports it.
   *
   * A block declaring no input reads nothing, so
   * no disagreement can reach it — which is the
   * ordinary shape of arms meeting again at a block
   * that only tidies up.
   */
  #checkWaysInAgree(node: WorkflowNode, dominating: string): void {
    const sources = new Set<string>();

    for (const edge of this.#graph.incoming.get(node.id) ?? []) {
      const from = edge.from.node;

      if (edge.back) continue;
      if (!this.#position.has(from)) continue;

      sources.add(bindsValue(this.#graph.nodes.get(from)) ? from : dominating);
    }

    if (sources.size < 2) return;

    const [first, second] = [...sources].sort(
      (a, b) => this.#at(a) - this.#at(b),
    );

    throw new UnsupportedIR(
      `\`${node.id}\` reads what \`${first}\` produced on one way into ` +
        `it and what \`${second}\` produced on another. This compiler ` +
        `gives a block one value, so it cannot follow both.`,
      node.id,
    );
  }

  /**
   * What the page after each block lists as still
   * to come.
   *
   * An approval's list starts where its two arms
   * meet again rather than at the block after it:
   * somebody who has just answered is being told
   * what happens next, and the arm they did not
   * take is not that.
   */
  #downstream(): Map<string, readonly string[]> {
    const titles = new Map<string, readonly string[]>();

    for (const id of this.#order) {
      const node = this.#graph.nodes.get(id);
      if (node === undefined) continue;

      titles.set(
        id,
        node.kind === 'approval'
          ? this.#titlesFrom(joinOf(this.#graph, id), true)
          : this.#titlesFrom(id, false),
      );
    }

    return titles;
  }

  /**
   * The work a run still has ahead of it at one
   * block, in the order it does it.
   *
   * Ordered by the run order rather than by the
   * walk, and cut off at the block itself, so a
   * loop's back edge cannot list the blocks that
   * came before as things still to come.
   */
  #titlesFrom(from: string | undefined, inclusive: boolean): string[] {
    if (from === undefined) return [];

    const ahead = reachableFrom(this.#graph, from);
    const floor = this.#at(from);
    const titles: string[] = [];

    for (const id of this.#order) {
      if (!ahead.has(id)) continue;
      if (this.#at(id) < floor) continue;
      if (this.#at(id) === floor && !inclusive) continue;

      const node = this.#graph.nodes.get(id);
      if (node === undefined || !WORK_KINDS.has(node.kind)) continue;

      titles.push(node.title);
    }

    return titles;
  }

  /**
   * Which wait each form-carrying email opens.
   *
   * The document declares the edge the other way —
   * a wait names the email its form arrives on —
   * and the token the email mints has to be scoped
   * to the wait, so the index is built once here.
   */
  #waitForEmail(chain: readonly WorkflowNode[]): Map<string, string> {
    const found = new Map<string, string>();

    for (const node of chain) {
      if (node.kind !== 'durableWait') continue;
      if (node.config.source.kind !== 'form') continue;

      found.set(node.config.source.email, node.id);
    }

    return found;
  }

  /** Where a block sits in the run order. */
  #at(id: string): number {
    return this.#position.get(id) ?? 0;
  }

  #findLoops(): void {
    for (const edge of this.#ir.edges) {
      if (!edge.back) continue;

      const branch = this.#graph.nodes.get(edge.from.node);
      const entry = this.#graph.nodes.get(edge.to.node);

      if (branch === undefined || entry === undefined) continue;
      if (!this.#position.has(entry.id)) continue;

      const already = this.#loops.get(entry.id);

      // Each case carries its own bound. One loop
      // has one, so honouring the second wire back
      // would mean throwing one author's limit
      // away and letting that case go round as
      // often as the other one allows.
      if (already !== undefined) {
        throw new UnsupportedIR(
          `\`${already.branch.id}\`'s \`${already.port}\` and ` +
            `\`${branch.id}\`'s \`${edge.from.port}\` both wire back to ` +
            `\`${entry.id}\`. This compiler emits one loop with one ` +
            `bound, so it cannot follow both.`,
          branch.id,
        );
      }

      this.#loops.set(entry.id, this.#loopRegion(edge, branch, entry.id));
    }
  }

  #loopRegion(
    edge: WorkflowEdge,
    branch: WorkflowNode,
    entry: string,
  ): LoopRegion {
    const members = this.#membersBetween(entry, branch.id);
    const found =
      branch.kind === 'branch'
        ? branch.config.cases.find((each) => each.port === edge.from.port)
        : undefined;

    if (found === undefined) {
      throw new UnsupportedIR(
        `\`${branch.id}\` wires back to \`${entry}\` from a way out that ` +
          `is not one of its cases.`,
        branch.id,
      );
    }

    let exit: string | undefined;

    for (const id of members) {
      for (const out of this.#graph.outgoing.get(id) ?? []) {
        if (out.back) continue;
        if (!this.#graph.nodes.has(out.to.node)) continue;
        if (members.has(out.to.node)) continue;

        if (exit !== undefined && exit !== out.to.node) {
          throw new UnsupportedIR(
            `\`${out.from.node}\` leaves this loop for \`${out.to.node}\` ` +
              `while another way out leads to \`${exit}\`. This compiler ` +
              `emits a loop with one way out.`,
            out.from.node,
          );
        }

        exit = out.to.node;
      }
    }

    return {
      entry,
      branch,
      port: edge.from.port,
      members,
      exit,
      rounds: found.maxIterations,
      onExhausted: found.onExhausted,
    };
  }

  /**
   * Every block on a path from the loop's entry to
   * the branch that closes it, both ends included.
   */
  #membersBetween(entry: string, branch: string): Set<string> {
    const forward = forwardFrom(this.#graph, entry);
    const members = new Set<string>();

    for (const id of forward) {
      if (forwardFrom(this.#graph, id).has(branch)) members.add(id);
    }

    return members;
  }

  /**
   * One stretch of blocks, from `entry` up to but
   * not including `stop`.
   *
   * `outcome` is what happens at the end of it:
   * `reached` when a run carries on at `stop`,
   * `ranOut` when the last block is wired to
   * nothing, `jumped` when every way out of it
   * already went somewhere else.
   */
  #walk(
    entry: string | undefined,
    stop: string | undefined,
    loop: LoopRegion | undefined,
  ): { items: PlanItem[]; outcome: 'reached' | 'ranOut' | 'jumped' } {
    const items: PlanItem[] = [];
    let run: WorkflowNode[] = [];
    let cursor = entry;
    let outcome: 'reached' | 'ranOut' | 'jumped' = 'ranOut';

    const flush = (): void => {
      for (const group of groupByGuard(run)) {
        items.push({ kind: 'blocks', group });
      }
      run = [];
    };

    while (cursor !== undefined && cursor !== stop) {
      const node = this.#node(cursor);
      const opening = this.#loops.get(node.id);

      if (opening !== undefined && opening !== loop) {
        flush();
        items.push(this.#repeat(opening));
        cursor = opening.exit;
        continue;
      }

      this.#claim(node);

      if (node.kind === 'loop') {
        flush();
        const counted = this.#countedLoop(node);
        items.push(counted.item);
        cursor = counted.after;
        continue;
      }

      if (node.kind === 'branch' || node.kind === 'approval') {
        flush();
        const choice = this.#choice(node, stop, loop);
        items.push(choice.item);

        if (choice.after !== undefined) {
          cursor = choice.after;
          continue;
        }

        return { items, outcome: choice.fallsThrough ? 'reached' : 'jumped' };
      }

      run.push(node);
      cursor = this.#next(node.id);
    }

    flush();

    if (cursor !== undefined && cursor === stop) outcome = 'reached';

    return { items, outcome };
  }

  #repeat(loop: LoopRegion): PlanItem {
    const body = this.#walk(loop.entry, undefined, loop).items;

    return {
      kind: 'repeat',
      entry: this.#node(loop.entry),
      branch: loop.branch,
      port: loop.port,
      rounds: loop.rounds,
      onExhausted: loop.onExhausted,
      carried: this.#carried(loop.members),
      body,
    };
  }

  /**
   * The `loop` block: its body is the run of blocks
   * it names, in that order, and a run carries on
   * at the one wire leaving the last of them.
   *
   * The order comes from the block's own list
   * rather than from the graph because validation
   * has already proved the two agree, and the list
   * is what the author sees.
   */
  #countedLoop(node: WorkflowNode): {
    item: PlanItem;
    after: string | undefined;
  } {
    if (node.kind !== 'loop') throw this.#notALoop(node);

    const members = new Set(node.config.body);
    const body: PlanItem[] = [];
    const blocks: WorkflowNode[] = [];

    for (const id of node.config.body) {
      const member = this.#node(id);
      this.#claim(member);
      blocks.push(member);
    }

    for (const group of groupByGuard(blocks)) {
      body.push({ kind: 'blocks', group });
    }

    const last = node.config.body.at(-1);
    const after = (this.#graph.outgoing.get(last ?? '') ?? []).find(
      (edge) => !edge.back && !members.has(edge.to.node),
    );

    return {
      item: {
        kind: 'countedLoop',
        node,
        rounds: node.config.maxRounds,
        carried: this.#carried(members),
        body,
      },
      after: after?.to.node,
    };
  }

  /**
   * A block a run leaves by one of several ways
   * out, and where each one goes.
   *
   * A branch and an approval are the same shape
   * here: ordered cases, first match wins, and the
   * ways out meeting again somewhere below. What
   * differs is only what each case tests, which is
   * `#armWhen`'s business.
   */
  #choice(
    node: WorkflowNode,
    stop: string | undefined,
    loop: LoopRegion | undefined,
  ): { item: PlanItem; after: string | undefined; fallsThrough: boolean } {
    const join = joinOf(this.#graph, node.id);

    // A join outside the loop is where a run goes
    // once it has left, so the arms break for it
    // rather than run on to it.
    const inside =
      loop === undefined || (join !== undefined && loop.members.has(join));
    const armStop = join !== undefined && join !== stop && inside ? join : stop;

    const arms: PlanArm[] = [];
    let fallsThrough = false;

    for (const port of portsOf(node)) {
      const when = this.#armWhen(node, port);
      const edge = (this.#graph.outgoing.get(node.id) ?? []).find(
        (each) =>
          each.from.port === port && this.#graph.nodes.has(each.to.node),
      );
      const target = this.#armTarget(edge, armStop, loop);

      if (target.kind === 'join') fallsThrough = true;
      if (target.kind === 'region' && target.outcome === 'reached') {
        fallsThrough = true;
      }

      arms.push({
        port,
        ...(when === undefined ? {} : { when }),
        target,
      });
    }

    return {
      item:
        node.kind === 'approval'
          ? {
              kind: 'approval',
              node,
              arms,
              downstream: this.#titlesFrom(join, true),
            }
          : { kind: 'branch', node, arms },
      after: armStop === join && join !== stop ? join : undefined,
      fallsThrough,
    };
  }

  /**
   * What one way out of a choice tests, or nothing
   * for the way a run takes when none of the others
   * matched.
   */
  #armWhen(node: WorkflowNode, port: string): Predicate | undefined {
    if (node.kind === 'approval') {
      return port === 'approved' ? APPROVED : undefined;
    }

    if (node.kind !== 'branch') throw this.#notALoop(node);

    return node.config.cases.find((each) => each.port === port)?.when;
  }

  #armTarget(
    edge: WorkflowEdge | undefined,
    armStop: string | undefined,
    loop: LoopRegion | undefined,
  ): ArmTarget {
    if (edge === undefined) return { kind: 'end' };

    const target = edge.to.node;

    if (loop !== undefined && edge.back && target === loop.entry) {
      return { kind: 'again' };
    }

    if (loop !== undefined && !loop.members.has(target)) {
      return { kind: 'leave' };
    }

    if (target === armStop) return { kind: 'join' };

    const walked = this.#walk(target, armStop, loop);

    return { kind: 'region', region: walked.items, outcome: walked.outcome };
  }

  /**
   * The values a loop produces that something after
   * it reads.
   *
   * Each one leaves the block it was bound in, so
   * it needs somewhere outside the loop to live.
   */
  #carried(members: ReadonlySet<string>): WorkflowNode[] {
    const carried: WorkflowNode[] = [];

    for (const id of members) {
      const node = this.#graph.nodes.get(id);
      if (node === undefined || !bindsValue(this.#graph.nodes.get(id))) continue;

      // A block behind a condition may not run on
      // any round, so there is nothing to promise
      // the blocks after the loop: a check saying
      // the value is always there would fail an
      // ordinary run. Validation has already proved
      // that whoever reads it either asked for no
      // input or carries the same condition, and
      // the emitter refuses the second of those by
      // name rather than promise what it cannot.
      if (node.guard !== undefined) continue;

      const read = [...this.#producers].some(
        ([consumer, producer]) => producer === id && !members.has(consumer),
      );

      if (read) carried.push(node);
    }

    return carried.sort((a, b) => this.#at(a.id) - this.#at(b.id));
  }

  #next(id: string): string | undefined {
    const outgoing = (this.#graph.outgoing.get(id) ?? []).filter(
      (edge) => !edge.back,
    );

    if (outgoing.length === 0) return undefined;
    if (outgoing.length > 1) {
      throw new UnsupportedIR(
        `\`${id}\` leaves by more than one wire, and this compiler only ` +
          `follows one.`,
        id,
      );
    }

    const edge = outgoing[0];
    if (edge === undefined) return undefined;

    if (!this.#graph.nodes.has(edge.to.node)) {
      throw new UnsupportedIR(
        `\`${id}\` wires to \`${edge.to.node}\`, which is not a block in ` +
          `this workflow.`,
        id,
      );
    }

    return edge.to.node;
  }

  #node(id: string): WorkflowNode {
    const node = this.#graph.nodes.get(id);

    if (node === undefined) {
      throw new UnsupportedIR(`\`${id}\` is not a block in this workflow.`, id);
    }

    return node;
  }

  #claim(node: WorkflowNode): void {
    if (this.#claimed.has(node.id)) {
      throw new UnsupportedIR(
        `\`${node.id}\` runs more than once, which this compiler does not ` +
          `emit yet.`,
        node.id,
      );
    }

    this.#claimed.add(node.id);
  }

  /**
   * Every block a run can reach is written down
   * somewhere.
   *
   * A block the walk never arrived at would simply
   * not be in the generated file, and nothing else
   * would say so: the file would compile, run, and
   * quietly skip work the canvas shows.
   */
  #checkNothingStranded(): void {
    for (const id of reachableFrom(this.#graph, this.#trigger.id)) {
      if (id === this.#trigger.id) continue;
      if (this.#claimed.has(id)) continue;

      throw new UnsupportedIR(
        `\`${id}\` is drawn as part of this workflow but nothing this ` +
          `compiler follows arrives at it.`,
        id,
      );
    }
  }

  #notALoop(node: WorkflowNode): UnsupportedIR {
    return new UnsupportedIR(
      `\`${node.id}\` is a kind this compiler does not emit yet.`,
      node.id,
    );
  }
}

/**
 * Consecutive blocks sharing a condition, compared
 * the way validation compares them — so what the
 * compiler groups is what the rule about guarded
 * consumers already checked.
 */
function groupByGuard(chain: readonly WorkflowNode[]): GuardGroup[] {
  const groups: GuardGroup[] = [];

  for (const node of chain) {
    const last = groups.at(-1);

    if (last !== undefined && sameGuard(last.guard, node.guard)) {
      groups[groups.length - 1] = {
        guard: last.guard,
        nodes: [...last.nodes, node],
      };
      continue;
    }

    groups.push({ guard: node.guard, nodes: [node] });
  }

  return groups;
}
