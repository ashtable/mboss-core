import type { LibManifest } from '../manifest/index.js';
import type {
  Predicate,
  Retry,
  WorkflowIR,
  WorkflowNode,
} from '../ir/index.js';

import {
  writeBackEdgeLoop,
  writeBranch,
  writeCountedLoop,
  type CarriedValue,
} from './emit-control.js';
import {
  importBlock,
  libTypeImport,
  libValueImport,
  type ImportEntry,
} from './imports.js';
import {
  LocalNames,
  camelCase,
  stepNameLiteral,
  type StepSegment,
} from './names.js';
import {
  planWorkflow,
  type ArmTarget,
  type EmissionPlan,
  type GuardGroup,
  type PlanArm,
  type PlanItem,
  type PlanRegion,
} from './plan.js';
import { literal, pathExpression, predicateExpression } from './predicate.js';
import { SourceWriter } from './source.js';
import { UnsupportedIR } from './unsupported.js';

/**
 * One workflow document, as the TypeScript file a
 * generated project runs.
 *
 * The file is assembled in two passes and that is
 * deliberate: the body is written first, into its
 * own buffer, and the imports are collected as it
 * discovers what it needs. Writing the imports
 * first would mean walking the document twice and
 * keeping the two walks in agreement.
 */

/** What the schema uses when a node says nothing. */
const DEFAULT_RETRY: Retry = {
  maxAttempts: 3,
  intervalSeconds: 1,
  backoffRate: 2,
};

/** The workflow's own parameter, for the two
 *  trigger modes that carry a payload. */
const PAYLOAD_PARAMETER = 'evt';

/** The body sits one level inside its function,
 *  and it has to measure its lines from there. */
const BODY_INDENT = 2;

export type EmitRequest = {
  ir: WorkflowIR;
  manifest: LibManifest;
  timezone: string;
};

export function emitWorkflow(request: EmitRequest): string {
  return new Emitter(request).emit();
}

class Emitter {
  readonly #ir: WorkflowIR;
  readonly #manifest: LibManifest;
  readonly #timezone: string;
  readonly #plan: EmissionPlan;
  readonly #locals: LocalNames;
  readonly #imports: ImportEntry[] = [];
  readonly #body = new SourceWriter(BODY_INDENT);

  /** The identifier the registered workflow is
   *  exported under, and the one it wraps. */
  readonly #exported: string;
  readonly #inner: string;

  /** What the file calls each handler it imports. */
  readonly #bindings = new Map<string, string>();

  /**
   * What each block's value is called, one frame
   * per open block.
   *
   * A guard's `if`, a branch's arm and a loop's
   * body each open one. A block emitted inside one
   * can read what the frames below it hold and
   * nothing else, which is exactly what the
   * generated file's own scoping does.
   */
  readonly #scopes: Map<string, string>[] = [new Map()];

  /** The counters of the loops now open, outermost
   *  first, which is the order a step name carries
   *  them in. */
  readonly #rounds: string[] = [];

  /**
   * The loops drawn as a wire back to an earlier
   * block that are open here, outermost first.
   *
   * `foldTo` is the bound a case carries in its own
   * condition, and is set only where the author
   * asked an exhausted case to fall through rather
   * than fail.
   */
  readonly #open: {
    round: string;
    resume: string;
    foldTo: number | undefined;
  }[] = [];

  /** The `let`s outside a loop that a value inside
   *  it is copied into. */
  readonly #carried = new Map<string, string[]>();

  constructor(request: EmitRequest) {
    this.#ir = request.ir;
    this.#manifest = request.manifest;
    this.#timezone = request.timezone;
    this.#plan = planWorkflow(request.ir);
    this.#exported = camelCase(request.ir.name);
    this.#inner = `${this.#exported}Fn`;

    this.#locals = new LocalNames([
      'DBOS',
      'appDb',
      PAYLOAD_PARAMETER,
      'scheduledTime',
      'context',
      'trigger',
      'checkPayload',
      'schedule',
      'waits',
      'eventWaits',
      'SCHEDULE_STARTS',
      'SCHEDULE_ENDS',
      this.#exported,
      this.#inner,
    ]);

    // Handlers are bound before anything else, so
    // the name a block calls does not depend on
    // the order the emitters happen to run in and
    // no node's local can shadow one.
    for (const node of this.#plan.chain) {
      if (node.handler !== undefined) this.#bind(node.handler.export);
    }
  }

  /**
   * The name the file calls a handler by.
   *
   * Its own export name, unless something else in
   * the file already answers to that — the workflow
   * itself, most often, when it is named after the
   * block it runs. One file cannot both import and
   * declare a single identifier, and that is not a
   * wrong type somewhere in it: it is a file that
   * does not compile at all.
   */
  #bind(exportName: string): string {
    const existing = this.#bindings.get(exportName);
    if (existing !== undefined) return existing;

    const free = !this.#locals.has(exportName);
    const name = this.#locals.take(free ? exportName : `${exportName}Handler`);

    this.#bindings.set(exportName, name);

    return name;
  }

  /**
   * Everything is emitted before anything is
   * assembled: the body is what discovers which
   * imports the file needs, and the import block
   * is printed above it.
   */
  emit(): string {
    this.#want({
      specifier: '@dbos-inc/dbos-sdk',
      name: 'DBOS',
      type: false,
    });

    const preamble = this.#preamble();
    this.#emitBounds();
    this.#emitRegion(this.#plan.region);

    const body = this.#body.toString();
    const tail = this.#emitDeclarations();
    const open = this.#openingLine(body === '');

    return [
      this.#header(),
      '\n',
      importBlock(this.#imports),
      '\n',
      preamble,
      open,
      body,
      body === '' ? '' : '}\n',
      '\n',
      tail,
    ].join('');
  }

  /**
   * Three lines and no timestamp. A header that
   * changed on every regeneration would make
   * "regeneration is clean" impossible to assert,
   * which is the one thing this file's own
   * pipeline has to be able to say.
   */
  #header(): string {
    return [
      '// GENERATED BY MBOSS — DO NOT EDIT.',
      '// Regenerated from',
      `// .mboss/workflows/${this.#ir.name}.workflow.json.`,
      '',
    ].join('\n');
  }

  /**
   * What stands above the workflow function.
   *
   * A schedule's bounds live here rather than in
   * the body: a date built inside a workflow is a
   * clock read, and one built from a literal at
   * module scope is a constant. The SDK's schedule
   * carries no start or end date, and deleting the
   * schedule to enforce one would not survive the
   * next boot, which reapplies it.
   */
  #preamble(): string {
    const trigger = this.#plan.trigger.config;
    if (trigger.mode !== 'schedule') return '';

    const writer = new SourceWriter();

    if (trigger.start !== undefined) {
      writer.line(`const SCHEDULE_STARTS = new Date('${trigger.start}');`);
    }
    if (trigger.ends !== undefined) {
      writer.line(`const SCHEDULE_ENDS = new Date('${trigger.ends}');`);
    }

    const text = writer.toString();
    return text === '' ? '' : `${text}\n`;
  }

  /**
   * The workflow function's own signature, ending
   * in the brace its body opens — or in `{}` when
   * there is no body, because that is how prettier
   * prints an empty one.
   */
  #openingLine(empty: boolean): string {
    const trigger = this.#plan.trigger.config;
    const tail = empty ? '{}' : '{';
    const writer = new SourceWriter();

    if (trigger.mode !== 'schedule') {
      const declared = this.#payloadType();
      const line =
        `async function ${this.#inner}(` +
        `${PAYLOAD_PARAMETER}: ${declared}): Promise<void> ${tail}`;

      if (writer.fits(line)) writer.line(line);
      else {
        writer.open(`async function ${this.#inner}(`);
        writer.line(`${PAYLOAD_PARAMETER}: ${declared},`);
        writer.close(`): Promise<void> ${tail}`);
      }

      return writer.toString();
    }

    // Both parameters are the SDK's, and the
    // return type has to be void.
    writer.line(`async function ${this.#inner}(`);
    writer.line('  scheduledTime: Date,');
    writer.line('  context: unknown,');
    writer.line(`): Promise<void> ${tail}`);

    return writer.toString();
  }

  /**
   * The start and end dates the trigger declared,
   * checked at the top of every run.
   */
  #emitBounds(): void {
    const trigger = this.#plan.trigger.config;
    if (trigger.mode !== 'schedule') return;

    if (trigger.start !== undefined) {
      this.#body.line('if (scheduledTime < SCHEDULE_STARTS) return;');
    }
    if (trigger.ends !== undefined) {
      this.#body.line('if (scheduledTime > SCHEDULE_ENDS) return;');
    }
    if (trigger.start !== undefined || trigger.ends !== undefined) {
      this.#body.blank();
    }
  }

  /**
   * The type of the payload a run is started with.
   *
   * A trigger that declares none leaves the
   * workflow taking `unknown`, which is honest: the
   * canvas has not said what arrives.
   */
  #payloadType(): string {
    const declared = this.#plan.trigger.out;
    if (declared === undefined) return 'unknown';

    this.#want(libTypeImport(this.#manifest, declared));
    return declared;
  }

  /** One stretch of blocks, in the order a run
   *  takes them. */
  #emitRegion(region: PlanRegion): void {
    for (const item of region) this.#emitItem(item);
  }

  #emitItem(item: PlanItem): void {
    switch (item.kind) {
      case 'blocks':
        this.#emitGroup(item.group);
        return;

      case 'branch':
        this.#emitBranch(item);
        return;

      case 'countedLoop':
        this.#emitCountedLoop(item);
        return;

      case 'repeat':
        this.#emitRepeat(item);
        return;
    }
  }

  #emitGroup(group: GuardGroup): void {
    const guard = group.guard;

    if (guard === undefined) {
      for (const node of group.nodes) this.#emitNode(node);
      return;
    }

    const first = group.nodes[0];
    if (first === undefined) return;

    // The condition stands outside the block it
    // opens, so it may only read what is in scope
    // out there.
    const root = this.#valueOf(first);
    if (root === undefined) throw this.#unreachableValue(first);

    this.#body.open(`if (${predicateExpression(root, guard)}) {`);
    this.#enter();
    for (const node of group.nodes) this.#emitNode(node);
    this.#leave();
    this.#body.close('}');
    this.#body.blank();
  }

  /**
   * A branch, as its cases in the order the author
   * wrote them.
   *
   * The condition reads the value that was flowing
   * when the run arrived here, which is the nearest
   * block above the branch that every run passes
   * through — a branch itself produces nothing.
   */
  #emitBranch(item: Extract<PlanItem, { kind: 'branch' }>): void {
    const root = this.#valueOf(item.node);
    if (root === undefined) throw this.#unreachableValue(item.node);

    writeBranch(
      this.#body,
      item.arms.map((arm) => ({
        ...(arm.when === undefined
          ? {}
          : { condition: this.#armCondition(root, arm.when, arm.target) }),
        body: () => this.#emitArm(arm),
      })),
    );
    this.#body.blank();
  }

  /**
   * A case's condition.
   *
   * The case that closes a loop and was told to
   * carry on when its rounds run out carries the
   * bound in the condition itself: on the last
   * round the case simply does not match, and the
   * run takes whichever way out the branch offers
   * next. That is what "as if the case had not
   * matched" has to mean in code.
   */
  #armCondition(root: string, when: Predicate, target: ArmTarget): string {
    const condition = predicateExpression(root, when);
    const loop = this.#open.at(-1);

    if (target.kind !== 'again' || loop?.foldTo === undefined) {
      return condition;
    }

    return `${loop.round} < ${loop.foldTo} && ${condition}`;
  }

  /**
   * One way out of a branch. Answers whether the
   * run leaves the branch by it.
   */
  #emitArm(arm: PlanArm): boolean {
    const target = arm.target;

    switch (target.kind) {
      case 'end':
        this.#body.line('return;');
        return true;

      case 'again':
        this.#body.line('continue;');
        return true;

      case 'leave': {
        // A way out of a loop only exists inside
        // one. Naming the flag anyway, rather than
        // guarding a state the plan cannot
        // produce, means a mistake here reaches
        // the type-check gate as an undeclared
        // name rather than as quietly wrong code.
        const resume = this.#open.at(-1)?.resume ?? 'resume';

        this.#body.line(`${resume} = true;`);
        this.#body.line('break;');
        return true;
      }

      case 'join':
        this.#body.comment('Nothing of its own to do on this way out.');
        return false;

      case 'region': {
        this.#enter();
        this.#emitRegion(target.region);
        this.#leave();

        if (target.outcome === 'ranOut') {
          // Wired to nothing, so the run stops
          // here rather than carrying on with what
          // the other ways out lead to.
          this.#body.line('return;');
          return true;
        }

        return target.outcome !== 'reached';
      }
    }
  }

  #emitCountedLoop(item: Extract<PlanItem, { kind: 'countedLoop' }>): void {
    const round = this.#locals.take('round');
    const carried = this.#hoist(item.carried);

    writeCountedLoop(this.#body, {
      round,
      rounds: item.rounds,
      carried,
      workflow: this.#ir.name,
      unreachable:
        'Unreachable: the loop runs at least once and assigns this. The ' +
        'check is here because the type says so and a cast would be a lie ' +
        'about which of the two is authoritative.',
      body: () => {
        this.#rounds.push(round);
        this.#enter();
        this.#emitRegion(item.body);
        this.#leave();
        this.#rounds.pop();
      },
    });
  }

  #emitRepeat(item: Extract<PlanItem, { kind: 'repeat' }>): void {
    const round = this.#locals.take('round');
    const resume = this.#locals.take('resume');
    const carried = this.#hoist(item.carried);
    const abort = item.onExhausted === 'abort';

    writeBackEdgeLoop(this.#body, {
      round,
      resume,
      carried,
      workflow: this.#ir.name,
      unreachable:
        `Unreachable: every way out of the loop that sets ${resume} has ` +
        'already assigned this. The check is here because the type says ' +
        'so and a cast would be a lie about which of the two is ' +
        'authoritative.',
      exhaustion: abort
        ? {
            kind: 'abort',
            rounds: item.rounds,
            problem:
              `${item.branch.id}: ${item.port} repeated ${item.rounds} ` +
              `times without a result.`,
          }
        : { kind: 'continue' },
      body: () => {
        this.#rounds.push(round);
        this.#open.push({
          round,
          resume,
          foldTo: abort ? undefined : item.rounds,
        });
        this.#enter();
        this.#emitRegion(item.body);
        this.#leave();
        this.#rounds.pop();
        this.#open.pop();
      },
    });
  }

  /**
   * Somewhere outside the loop for the values
   * inside it that something after it reads.
   *
   * The name is declared in the frame the loop
   * itself sits in, so a reader outside finds it
   * and a reader inside finds the loop-local
   * `const` instead — which is the one the step's
   * own callback closes over, and the only one
   * `strict` keeps narrowed.
   */
  #hoist(nodes: readonly WorkflowNode[]): CarriedValue[] {
    return nodes.map((node) => {
      const name = this.#locals.take(`${camelCase(node.id)}Carried`);

      this.#declare(node.id, name);
      this.#carried.set(node.id, [...(this.#carried.get(node.id) ?? []), name]);

      return { name, type: this.#valueType(node), nodeId: node.id };
    });
  }

  /**
   * What a block said it produces. A block that
   * said nothing leaves the value `unknown`, which
   * is honest rather than a guess.
   */
  #valueType(node: WorkflowNode): string {
    if (node.out === undefined) return 'unknown';

    this.#want(libTypeImport(this.#manifest, node.out));
    return node.out;
  }

  #emitNode(node: WorkflowNode): void {
    switch (node.kind) {
      case 'step':
      case 'codeStep':
      case 'apiCall':
        if (node.kind === 'apiCall') {
          this.#body.comment(`External service: ${node.config.service}.`);
        }
        if (node.forEach !== undefined) this.#emitForEach(node);
        else this.#emitStep(node);
        break;

      case 'transaction':
        if (node.forEach !== undefined) this.#emitForEach(node);
        else this.#emitTransaction(node);
        break;

      default:
        throw new UnsupportedIR(
          `\`${node.id}\` is a kind this compiler does not emit yet.`,
          node.id,
        );
    }

    this.#copyOut(node);
    this.#body.blank();
  }

  /**
   * The copy from a loop-local `const` into the
   * `let` outside the loop.
   *
   * Two names for one value, and both are needed:
   * the step's callback closes over the `const`, so
   * `strict` keeps it narrowed, and the `let` is
   * what the blocks after the loop can see.
   */
  #copyOut(node: WorkflowNode): void {
    const local = this.#scopes.at(-1)?.get(node.id);
    if (local === undefined) return;

    for (const name of this.#carried.get(node.id) ?? []) {
      this.#body.line(`${name} = ${local};`);
    }
  }

  #emitStep(node: WorkflowNode): void {
    const local = this.#local(node);
    const call = this.#handlerCall(node, this.#valueOf(node));
    const head = `const ${local} = await DBOS.runStep`;

    expandedCall(this.#body, head, `async () => ${call}`, [
      `name: ${stepNameLiteral(node.id, this.#segments([]))},`,
      ...retryOptions(node.retry),
    ]);
  }

  #emitTransaction(node: WorkflowNode): void {
    const local = this.#local(node);
    const call = this.#handlerCall(node, this.#valueOf(node));
    const name = stepNameLiteral(node.id, this.#segments([]));
    const one =
      `const ${local} = await appDb.runTransaction(async () => ${call}, ` +
      `{ name: ${name} });`;

    this.#want({ specifier: '../app/db.js', name: 'appDb', type: false });

    if (this.#body.fits(one)) {
      this.#body.line(one);
      return;
    }

    this.#body.open(`const ${local} = await appDb.runTransaction(`);
    this.#body.line(`async () => ${call},`);
    this.#body.line(`{ name: ${name} },`);
    this.#body.close(');');
  }

  /**
   * Fan-out, in chunks, with every rejection
   * accounted for.
   *
   * `Promise.allSettled` rather than `Promise.all`
   * is the whole shape: `all` rejects at the first
   * failure and the run dies before the items
   * still in flight have checkpointed, so a retry
   * re-runs work that had already succeeded.
   */
  #emitForEach(node: WorkflowNode): void {
    const fanOut = node.forEach;
    if (fanOut === undefined) return;

    const root = this.#valueOf(node);
    if (root === undefined) throw this.#unreachableValue(node);

    // A block the canvas drew as a transaction
    // stays one when it fans out. Running its
    // items as plain steps would leave the handler
    // writing through a client that only exists
    // inside a transaction, and every item would
    // then fail for a reason pointing at the
    // items.
    const inTransaction = node.kind === 'transaction';

    if (inTransaction) {
      this.#want({ specifier: '../app/db.js', name: 'appDb', type: false });
    }

    const items = this.#locals.take('items');
    const settled = this.#locals.take('settled');
    const failed = this.#locals.take('failed');
    const local = this.#local(node);
    const itemType = this.#itemType(node);
    const size = fanOut.concurrency;

    this.#body.comment(
      'allSettled rather than all: one rejection must not take the ' +
        'process down before the others have checkpointed.',
    );
    const list = pathExpression(root, fanOut.itemsPath);

    this.#body.line(`const ${items} = ${list};`);
    this.#body.line(
      `const ${settled}: PromiseSettledResult<${itemType}>[] = [];`,
    );
    this.#body.open(
      `for (let offset = 0; offset < ${items}.length; offset += ${size}) {`,
    );
    this.#body.line(`const chunk = ${items}.slice(offset, offset + ${size});`);
    this.#body.open('const settledChunk = await Promise.allSettled(');
    this.#body.open('chunk.map((item, index) =>');
    expandedCall(
      this.#body,
      inTransaction ? 'appDb.runTransaction' : 'DBOS.runStep',
      `async () => ${this.#handlerCall(node, 'item')}`,
      [
        `name: ${stepNameLiteral(node.id, this.#segments([{ kind: 'item' }]))},`,
        // A transaction's config carries an
        // isolation level, a read-only flag and a
        // name, and nothing at all about retries.
        ...(inTransaction ? [] : retryOptions(node.retry)),
      ],
      ',',
    );
    this.#body.close('),');
    this.#body.close(');');
    this.#body.line(`${settled}.push(...settledChunk);`);
    this.#body.close('}');
    this.#body.blank();

    this.#body.line(
      `const ${failed} = ${settled}.filter((r) => r.status === 'rejected');`,
    );
    this.#body.open(`if (${failed}.length > 0) {`);
    this.#body.open('throw new Error(');
    this.#body.line(
      `\`${node.id}: \${${failed}.length} of \${${settled}.length} ` +
        'items failed`,',
    );
    this.#body.close(');');
    this.#body.close('}');
    this.#body.blank();

    this.#body.open(`const ${local} = ${settled}.flatMap((r) =>`);
    this.#body.line("r.status === 'fulfilled' ? [r.value] : [],");
    this.#body.close(');');
  }

  /**
   * The per-item type a fan-out produces.
   *
   * The node's declared `out` names what the
   * handler returns for one item, while the local
   * it fills holds a list of them. Nothing in the
   * catalog can say "a list of Booking", so the
   * mismatch is real and surfaces at the
   * type-check gate rather than here.
   */
  #itemType(node: WorkflowNode): string {
    if (node.out === undefined) return 'unknown';

    this.#want(libTypeImport(this.#manifest, node.out));
    return node.out;
  }

  /**
   * The handler call itself.
   *
   * An argument is passed whenever the function
   * behind the block declares a parameter. What the
   * block says about its own input does not change
   * how many arguments its handler takes, so a
   * block with no declared input still hands its
   * handler a value — and where there is no value
   * to hand it, the document is refused rather than
   * compiled into a call that cannot run.
   */
  #handlerCall(node: WorkflowNode, input: string | undefined): string {
    const handler = node.handler;

    if (handler === undefined) {
      throw new UnsupportedIR(
        `\`${node.id}\` has no handler, so there is nothing to call.`,
        node.id,
      );
    }

    const entry = libValueImport(this.#manifest, handler.export);
    const binding = this.#bind(handler.export);

    this.#want(binding === entry.name ? entry : { ...entry, alias: binding });

    const fn = this.#manifest.functions.find(
      (each) => each.export === handler.export,
    );

    if ((fn?.params.length ?? 0) === 0) return `${binding}()`;
    if (input === undefined) throw this.#unreachableValue(node);

    return `${binding}(${input})`;
  }

  /**
   * Where a block reads its input from, or
   * undefined when nothing in scope there holds it.
   *
   * Two ways a value is not there. A run the clock
   * starts carries no payload, and the SDK's
   * signature for a scheduled workflow binds no
   * parameter that could hold one. And a block
   * behind a condition binds its result inside that
   * condition's block, so nothing outside the block
   * can name it.
   */
  #valueOf(node: WorkflowNode): string | undefined {
    const producer = this.#plan.producers.get(node.id);

    if (producer === undefined || producer === this.#plan.trigger.id) {
      return this.#plan.trigger.config.mode === 'schedule'
        ? undefined
        : PAYLOAD_PARAMETER;
    }

    return this.#lookup(producer);
  }

  /** The local a block's value is bound to, taken
   *  and put in scope here. */
  #local(node: WorkflowNode): string {
    const local = this.#locals.forNode(node.id);

    this.#declare(node.id, local);
    return local;
  }

  #declare(nodeId: string, name: string): void {
    this.#scopes.at(-1)?.set(nodeId, name);
  }

  /** What a block's value is called here, or
   *  undefined where it cannot be named. */
  #lookup(nodeId: string): string | undefined {
    for (let depth = this.#scopes.length - 1; depth >= 0; depth -= 1) {
      const name = this.#scopes[depth]?.get(nodeId);
      if (name !== undefined) return name;
    }

    return undefined;
  }

  #enter(): void {
    this.#scopes.push(new Map());
  }

  #leave(): void {
    this.#scopes.pop();
  }

  /**
   * The regions a step is inside, as its recorded
   * name carries them: one per open loop, outermost
   * first, then the step's own.
   *
   * DBOS compares the recorded name at each
   * function id on replay, so two rounds of one
   * block have to record two different names or
   * every recovery fails.
   */
  #segments(own: readonly StepSegment[]): StepSegment[] {
    return [
      ...this.#rounds.map((name) => ({ kind: 'round' as const, name })),
      ...own,
    ];
  }

  /**
   * What to say about a block reading a value
   * nothing can hand it.
   *
   * It names the other block, because the fix is a
   * change to how the two are drawn rather than to
   * either one on its own.
   */
  #unreachableValue(node: WorkflowNode): UnsupportedIR {
    const producer = this.#plan.producers.get(node.id);

    if (producer === undefined || producer === this.#plan.trigger.id) {
      return new UnsupportedIR(
        `\`${node.id}\` reads the payload the run started with, but a run ` +
          `the clock starts carries no payload to give it.`,
        node.id,
      );
    }

    return new UnsupportedIR(
      `\`${node.id}\` reads what \`${producer}\` produced, but ` +
        `\`${producer}\` only runs when its condition holds. Give ` +
        `\`${node.id}\` the same condition.`,
      node.id,
    );
  }

  /**
   * Everything after the workflow function: the
   * registration, the descriptors the runtime
   * reads, and the two wait tables the registry
   * names.
   */
  #emitDeclarations(): string {
    const writer = new SourceWriter();
    const trigger = this.#plan.trigger.config;

    const registration =
      `export const ${this.#exported} = DBOS.registerWorkflow(` +
      `${this.#inner}, { name: '${this.#ir.name}' });`;

    if (writer.fits(registration)) writer.line(registration);
    else {
      expandedCall(
        writer,
        `export const ${this.#exported} = DBOS.registerWorkflow`,
        this.#inner,
        [`name: '${this.#ir.name}',`],
      );
    }
    writer.blank();

    this.#want({
      specifier: '../app/contract.js',
      name: 'TriggerDescriptor',
      type: true,
    });

    if (trigger.mode === 'event') {
      writer.open('export const trigger: TriggerDescriptor = {');
      writer.line("mode: 'event',");
      writer.line(`topic: ${literal(trigger.topic)},`);
      if (trigger.idempotencyKeyPath !== undefined) {
        writer.line(
          `idempotencyKeyPath: ${literal(trigger.idempotencyKeyPath)},`,
        );
      }
      if (trigger.requesterEmailPath !== undefined) {
        writer.line(
          `requesterEmailPath: ${literal(trigger.requesterEmailPath)},`,
        );
      }
      writer.close('};');
    } else {
      const mode = `{ mode: '${trigger.mode}' }`;

      writer.line(`export const trigger: TriggerDescriptor = ${mode};`);
    }
    writer.blank();

    this.#emitCheckPayload(writer);

    if (trigger.mode === 'schedule') {
      this.#want({
        specifier: '../app/contract.js',
        name: 'ScheduleEntry',
        type: true,
      });

      writer.blank();
      writer.open('export const schedule: ScheduleEntry = {');
      writer.line(`scheduleName: ${literal(this.#ir.name)},`);
      writer.line(`workflowFn: ${this.#exported},`);
      writer.line(`schedule: ${literal(trigger.cron)},`);
      writer.line(
        `cronTimezone: ${literal(trigger.timezone ?? this.#timezone)},`,
      );
      // Work the app missed while it was down is
      // still work somebody expected.
      writer.line('automaticBackfill: true,');
      writer.close('};');
    }

    writer.blank();
    this.#want({
      specifier: '../app/contract.js',
      name: 'WaitDescriptor',
      type: true,
    });
    this.#want({
      specifier: '../app/contract.js',
      name: 'EventWait',
      type: true,
    });
    writer.line('export const waits: Record<string, WaitDescriptor> = {};');
    writer.blank();
    writer.line('export const eventWaits: EventWait[] = [];');

    return writer.toString();
  }

  /**
   * The payload check, compiled against the type
   * the trigger declared.
   *
   * It checks exactly what it can know: that the
   * payload is an object and that the declared
   * paths hold non-empty strings. Pretending to be
   * a structural validator, over a manifest that
   * carries no structure, would be a claim it
   * could not keep.
   */
  #emitCheckPayload(writer: SourceWriter): void {
    this.#want({
      specifier: '../app/contract.js',
      name: 'PayloadCheck',
      type: true,
    });

    const trigger = this.#plan.trigger.config;

    if (trigger.mode !== 'event') {
      writer.line('export function checkPayload(): PayloadCheck {');
      writer.line(
        '  return { ok: true, key: undefined, requesterEmail: undefined };',
      );
      writer.line('}');
      return;
    }

    const keyPath = trigger.idempotencyKeyPath;
    const emailPath = trigger.requesterEmailPath;

    writer.open(
      'export function checkPayload(payload: unknown): PayloadCheck {',
    );
    writer.open("if (typeof payload !== 'object' || payload === null) {");
    writer.line(
      "return { ok: false, problem: 'the payload is not an object' };",
    );
    writer.close('}');

    if (keyPath !== undefined || emailPath !== undefined) {
      writer.line(`const event = payload as Partial<${this.#castType()}>;`);
    }

    if (keyPath !== undefined) {
      writer.line(`const key = ${pathExpression('event', keyPath)};`);
      writer.open("if (typeof key !== 'string' || key === '') {");
      writer.line(`return { ok: false, problem: '${keyPath} is missing' };`);
      writer.close('}');
    }

    if (emailPath !== undefined) {
      writer.line(
        `const requesterEmail = ${pathExpression('event', emailPath)};`,
      );
      writer.open(
        "if (typeof requesterEmail !== 'string' || requesterEmail === '') {",
      );
      writer.line(`return { ok: false, problem: '${emailPath} is missing' };`);
      writer.close('}');
    }

    // Shorthand where the value was bound above,
    // and an explicit undefined where the trigger
    // declared no path to read it from.
    const key = keyPath === undefined ? 'key: undefined' : 'key';
    const email =
      emailPath === undefined ? 'requesterEmail: undefined' : 'requesterEmail';

    writer.line(`return { ok: true, ${key}, ${email} };`);
    writer.close('}');
  }

  /**
   * What `checkPayload` reads the declared paths
   * out of.
   *
   * A trigger that names a path but no type has
   * nowhere to read it from, and guessing would
   * put a correlation key in the world that
   * nothing can find.
   */
  #castType(): string {
    const declared = this.#plan.trigger.out;

    if (declared === undefined) {
      throw new UnsupportedIR(
        `\`${this.#plan.trigger.id}\` names a path in its payload but ` +
          `does not say what the payload is, so there is nothing to read ` +
          `it out of.`,
        this.#plan.trigger.id,
      );
    }

    this.#want(libTypeImport(this.#manifest, declared));
    return declared;
  }

  #want(entry: ImportEntry): void {
    this.#imports.push(entry);
  }
}

/**
 * A call whose last argument is an options object,
 * laid out the way prettier lays it out: hugged
 * onto the call when the head fits, and with every
 * argument on a line of its own when it does not.
 *
 * A free function over a writer rather than a
 * method, because the body and the declarations
 * below it are written into different buffers and
 * both have calls too wide for one line.
 */
function expandedCall(
  writer: SourceWriter,
  head: string,
  argument: string,
  options: readonly string[],
  terminator = ';',
): void {
  const hug = `${head}(${argument}, {`;

  if (writer.fits(hug)) {
    writer.open(hug);
    for (const option of options) writer.line(option);
    writer.close(`})${terminator}`);
    return;
  }

  writer.open(`${head}(`);
  writer.line(`${argument},`);
  writer.open('{');
  for (const option of options) writer.line(option);
  writer.close('},');
  writer.close(`)${terminator}`);
}

/**
 * `retriesAllowed` is written on every step. The
 * SDK's default is `false`, so a template that
 * leaves it out silently turns every retry off,
 * and a reader of the generated file would have no
 * way to tell.
 */
function retryOptions(retry: Retry | undefined): string[] {
  const policy = retry ?? DEFAULT_RETRY;

  if (policy.maxAttempts === 1) return ['retriesAllowed: false,'];

  return [
    'retriesAllowed: true,',
    `maxAttempts: ${policy.maxAttempts},`,
    `intervalSeconds: ${policy.intervalSeconds},`,
    `backoffRate: ${policy.backoffRate},`,
  ];
}
