import type { LibManifest } from '../manifest/index.js';
import type {
  FormField,
  Predicate,
  Recipient,
  Retry,
  WaitSource,
  WorkflowIR,
  WorkflowNode,
} from '../ir/index.js';
import { sameGuard } from '../validate/rules.js';

import {
  expandedCall,
  writeBackEdgeLoop,
  writeBranch,
  writeCountedLoop,
  writeThrow,
  type CarriedValue,
} from './emit-control.js';
import {
  call,
  list,
  object,
  source,
  writeStep,
  writeTimer,
  writeValue,
  writeWait,
  type Emitted,
  type EmittedEntry,
  type StepSpec,
  type WaitShape,
} from './emit-wait.js';
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

/** The run's own id, which every row a wait writes
 *  and every email it sends is addressed by. */
const RUN_ID = 'runId';

/** The address of whoever asked for the run, read
 *  once from the event that started it. */
const REQUESTER = 'requesterEmail';

const SECONDS_PER_DAY = 86400;

/**
 * How long a wait that named no limit of its own
 * runs for.
 *
 * `recv` with no timeout returns null after sixty
 * seconds, so leaving it to the SDK would abort a
 * wait for a person a minute after the email went
 * out. Seven days is inside the form token's own
 * lifetime, so the link never dies before the wait
 * it opens.
 */
const DEFAULT_WAIT_DAYS = 7;

/**
 * How many reminders a wait sends when the author
 * asked for reminders and did not say how many.
 *
 * One: the smallest number that makes "remind
 * them" mean anything, and the run still ends
 * rather than nagging forever.
 */
const DEFAULT_RESENDS = 1;

/**
 * How long a link to something in storage lasts.
 * The token type's own lifetime, so a link that
 * verifies is a link the store will still serve.
 */
const ARTIFACT_SECONDS = 7 * SECONDS_PER_DAY;

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
      'sendNodeEmail',
      'isTransientSendFailure',
      'registerWaitCorrelation',
      'clearWaitCorrelation',
      RUN_ID,
      REQUESTER,
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
    this.#emitPrelude();
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

      case 'approval':
        this.#emitApproval(item);
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

    this.#writeArms(root, item.arms);
  }

  /**
   * The ways out of a choice, in the order the
   * author wrote them, reading the value named
   * here.
   *
   * Shared with the approval, whose two ways out
   * are a branch in everything but where the value
   * they test came from.
   */
  #writeArms(root: string, arms: readonly PlanArm[]): void {
    writeBranch(
      this.#body,
      arms.map((arm) => ({
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

      case 'durableWait':
        this.#emitWait(node);
        break;

      case 'emailSend':
        this.#emitEmail(node);
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
    const perItem = this.#segments([{ kind: 'item' }]);

    expandedCall(
      this.#body,
      inTransaction ? 'appDb.runTransaction' : 'DBOS.runStep',
      `async () => ${this.#handlerCall(node, 'item')}`,
      [
        `name: ${stepNameLiteral(node.id, perItem)},`,
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
   * The two things a run has to know about itself
   * before any wait or email can name it.
   *
   * The run's id is read once, checked once, and
   * used by every row a wait writes and every
   * email it sends. `?? ''` instead of the check
   * would put a correlation key in the world that
   * nothing can ever find.
   */
  #emitPrelude(): void {
    if (this.#needsRunId()) {
      this.#body.line(`const ${RUN_ID} = DBOS.workflowID;`);
      this.#body.open(`if (${RUN_ID} === undefined) {`);
      writeThrow(
        this.#body,
        `${this.#ir.name}: no workflow id — not running as a workflow.`,
      );
      this.#body.close('}');
      this.#body.blank();
    }

    if (!this.#needsRequester()) return;

    this.#body.line(
      `const ${REQUESTER} = ${pathExpression(
        PAYLOAD_PARAMETER,
        this.#requesterPath(),
      )};`,
    );
    this.#body.blank();
  }

  /** Whether anything this run does is addressed
   *  to the run itself. */
  #needsRunId(): boolean {
    return this.#plan.chain.some(
      (node) =>
        node.kind === 'emailSend' ||
        node.kind === 'approval' ||
        (node.kind === 'durableWait' && node.config.source.kind !== 'timer'),
    );
  }

  #needsRequester(): boolean {
    return this.#plan.chain.some(
      (node) =>
        (node.kind === 'emailSend' || node.kind === 'approval') &&
        node.config.to === 'requestingUser',
    );
  }

  /**
   * Where in the starting event the requesting
   * user's address is.
   *
   * Validation already refuses a document that
   * writes to the requesting user without one, so
   * this is the compiler refusing to guess rather
   * than a case anybody meets.
   */
  #requesterPath(): string {
    const trigger = this.#plan.trigger.config;
    const path =
      trigger.mode === 'event' ? trigger.requesterEmailPath : undefined;

    if (path === undefined) {
      throw new UnsupportedIR(
        `this workflow writes to whoever asked for the run, but its ` +
          `trigger does not say where to find their address.`,
        this.#plan.trigger.id,
      );
    }

    return path;
  }

  /**
   * A durable pause.
   *
   * A wait on the clock is a different thing from
   * a wait on somebody: it has no sender, so there
   * is nothing to correlate with, nothing to remind
   * and no answer to check.
   */
  #emitWait(node: WorkflowNode): void {
    if (node.kind !== 'durableWait') return;

    const config = node.config;

    // Asked before the wait on the clock takes its
    // own way out below: a timer told to remind
    // somebody is a drawing that cannot be honoured
    // either, and it would otherwise compile to a
    // sleep that quietly forgets the reminder.
    this.#checkResendable(node);

    if (config.source.kind === 'timer') {
      writeTimer(this.#body, config.source.seconds);
      return;
    }

    const local = this.#local(node);
    const resend = this.#resend(node);
    const days = config.timeoutDays ?? DEFAULT_WAIT_DAYS;

    this.#want(waitsImport('registerWaitCorrelation'));
    this.#want(waitsImport('clearWaitCorrelation'));

    const shape: WaitShape = {
      local,
      type: this.#valueType(node),
      topic: node.id,
      timeoutSeconds: days * SECONDS_PER_DAY,
      why: [timeoutWhy(config.timeoutDays)],
      register: this.#registerStep(
        node,
        topicOf(config.source),
        this.#correlationKey(node, config.source),
      ),
      clear: this.#clearStep(node),
      ...(resend === undefined ? {} : { resend }),
      onNothing: this.#onNothing(node, days),
    };

    writeWait(this.#body, shape);
  }

  /**
   * Writing the row an arriving message is looked
   * up by.
   *
   * It goes through a step, like the clearing
   * below: both touch the app's own database, and a
   * workflow body that wrote to it directly would
   * repeat the write on every replay.
   */
  #registerStep(node: WorkflowNode, topic: string, key: string): StepSpec {
    return {
      head: 'await DBOS.runStep',
      call: call(
        'registerWaitCorrelation',
        object([
          { key: RUN_ID },
          { key: 'nodeId', value: source(literal(node.id)) },
          { key: 'topic', value: source(literal(topic)) },
          { key: 'key', value: source(key) },
        ]),
      ),
      options: this.#waitStepOptions(node, 'register'),
    };
  }

  #clearStep(node: WorkflowNode): StepSpec {
    return {
      head: 'await DBOS.runStep',
      call: source(`clearWaitCorrelation(${RUN_ID}, ${literal(node.id)})`),
      options: this.#waitStepOptions(node, 'clear'),
    };
  }

  #waitStepOptions(node: WorkflowNode, which: 'register' | 'clear'): string[] {
    const name = stepNameLiteral(node.id, this.#segments([{ kind: which }]));

    return [`name: ${name},`, ...retryOptions(node.retry)];
  }

  /**
   * The value an arriving message is matched
   * against.
   *
   * A form's is the waiting node itself: every run
   * parked there registers the same key, and which
   * run a submitted form wakes is settled by the
   * link, which carries the run. An event's is read
   * out of what was flowing when the run parked.
   */
  #correlationKey(node: WorkflowNode, waitOn: WaitSource): string {
    if (waitOn.kind !== 'event') return literal(node.id);

    const root = this.#valueOf(node);
    if (root === undefined) throw this.#unreachableValue(node);

    return pathExpression(root, waitOn.correlateWith);
  }

  /** What a run does when nothing ever arrives. */
  #onNothing(node: WorkflowNode, days: number): WaitShape['onNothing'] {
    if (node.kind !== 'durableWait') return { kind: 'return' };

    const config = node.config;
    const after =
      config.onTimeout === 'resend' ? (config.afterMax ?? 'abort') : 'abort';

    // Carrying on would mean running the blocks
    // below with no value to give them, and every
    // one of them said what it expects.
    if (after === 'continue') return { kind: 'return' };

    return {
      kind: 'throw',
      problem: `${node.id}: nothing arrived within ${daysText(days)}.`,
    };
  }

  /**
   * The reminder, where the author asked for one.
   *
   * Only a wait on a form has anything to send
   * again. A wait on an event has no email behind
   * it and a wait on the clock has no recipient, so
   * a reminder on either is refused by name rather
   * than quietly dropped.
   */
  #checkResendable(node: WorkflowNode): void {
    if (node.kind !== 'durableWait') return;

    const config = node.config;
    if (config.onTimeout !== 'resend') return;
    if (config.source.kind === 'form') return;

    throw new UnsupportedIR(
      `\`${node.id}\` sends a reminder when nothing arrives, but it is ` +
        `waiting on ${
          config.source.kind === 'timer' ? 'the clock' : 'an event'
        } rather than on a form, so there is no email to send again.`,
      node.id,
    );
  }

  #resend(node: WorkflowNode): WaitShape['resend'] {
    if (node.kind !== 'durableWait') return undefined;

    const config = node.config;
    if (config.onTimeout !== 'resend') return undefined;
    if (config.source.kind !== 'form') return undefined;

    const email = this.#nodeById(config.source.email, node.id);
    const counter = this.#locals.take(`${camelCase(node.id)}Resends`);
    const name = stepNameLiteral(
      node.id,
      this.#segments([{ kind: 'resend', counter }]),
    );

    return {
      counter,
      max: config.maxResends ?? DEFAULT_RESENDS,
      step: this.#emailStep(email, name),
    };
  }

  /**
   * One email, sent inside one step.
   *
   * Everything the message needs is built here and
   * everything irreproducible happens in the
   * runtime call: the link is minted, the template
   * rendered and the message sent inside the step,
   * so a replay re-runs none of it and the person
   * is not holding a token the app has forgotten.
   */
  #emitEmail(node: WorkflowNode): void {
    if (node.kind !== 'emailSend') return;

    const name = stepNameLiteral(node.id, this.#segments([]));

    if (retriesOn(node.retry)) {
      this.#body.comment(
        'A retry can send a second copy when the provider accepted a ' +
          'request whose response was lost. A run that never sends its ' +
          'only link sleeps until its timeout, which is worse.',
      );
    }

    writeStep(this.#body, this.#emailStep(node, name));
  }

  #emailStep(node: WorkflowNode, name: string): StepSpec {
    if (node.kind !== 'emailSend') throw this.#notAnEmail(node);

    const retries = retriesOn(node.retry);

    this.#want({
      specifier: '../app/mail.js',
      name: 'sendNodeEmail',
      type: false,
    });
    if (retries) {
      this.#want({
        specifier: '../app/mailer.js',
        name: 'isTransientSendFailure',
        type: false,
      });
    }

    return {
      head: 'await DBOS.runStep',
      call: call(
        'sendNodeEmail',
        object([
          { key: RUN_ID },
          { key: 'workflowTitle', value: source(literal(this.#title())) },
          { key: 'nodeId', value: source(literal(node.id)) },
          { key: 'to', value: source(this.#recipient(node.config.to)) },
          { key: 'subject', value: source(literal(node.config.subject)) },
          {
            key: 'bodyMarkdown',
            value: source(literal(node.config.bodyMarkdown)),
          },
          { key: 'attach', value: this.#attach(node) },
          { key: 'downstream', value: this.#downstreamOf(node) },
        ]),
      ),
      options: [
        `name: ${name},`,
        ...retryOptions(node.retry),
        ...(retries ? ['shouldRetry: isTransientSendFailure,'] : []),
      ],
    };
  }

  /**
   * What the email carries beyond its words.
   *
   * The IR says what the author drew; the runtime
   * says which page a token opens. They are
   * deliberately different words for different
   * things, and this is the only place that
   * translates between them.
   */
  #attach(node: WorkflowNode): Emitted {
    if (node.kind !== 'emailSend') throw this.#notAnEmail(node);

    const attach = node.config.attach;

    if (attach.type === 'none') {
      return object([{ key: 'kind', value: source(literal('none')) }]);
    }

    if (attach.type === 'artifactLink') {
      const root = this.#valueOf(node);
      if (root === undefined) throw this.#unreachableValue(node);

      return object([
        { key: 'kind', value: source(literal('artifact')) },
        {
          key: 'key',
          value: source(pathExpression(root, attach.artifactPath)),
        },
        {
          key: 'expiresInSeconds',
          value: source(String(ARTIFACT_SECONDS)),
        },
      ]);
    }

    const waitId = this.#plan.waitForEmail.get(node.id);

    // The token is scoped to the wait, and the page
    // it opens is looked up by that. An email whose
    // form nothing waits on has nowhere to point,
    // and the link it sent would serve a 400 while
    // verifying perfectly.
    if (waitId === undefined) {
      throw new UnsupportedIR(
        `\`${node.id}\` carries a form, but no wait in this workflow is ` +
          `waiting for it to come back, so the link it sends would open ` +
          `nothing.`,
        node.id,
      );
    }

    return object([
      { key: 'kind', value: source(literal('form')) },
      { key: 'nodeId', value: source(literal(waitId)) },
      { key: 'fields', value: this.#fields(node, attach.form.fields) },
      {
        key: 'expiresInSeconds',
        value: source(String(this.#waitSeconds(waitId))),
      },
    ]);
  }

  /** How long the link into a wait outlives its
   *  sending, which is as long as the wait runs. */
  #waitSeconds(waitId: string): number {
    const wait = this.#nodeById(waitId, waitId);
    const days =
      wait.kind === 'durableWait'
        ? (wait.config.timeoutDays ?? DEFAULT_WAIT_DAYS)
        : DEFAULT_WAIT_DAYS;

    return days * SECONDS_PER_DAY;
  }

  /** The fields the page draws, with the two
   *  optional flags answered once here. */
  #fields(node: WorkflowNode, fields: readonly FormField[]): Emitted {
    return list(
      fields.map((field, index) =>
        object([
          { key: 'id', value: source(literal(field.id)) },
          { key: 'label', value: source(literal(field.label)) },
          { key: 'type', value: source(literal(field.type)) },
          { key: 'required', value: source(String(field.required ?? false)) },
          { key: 'multiple', value: source(String(field.multiple ?? false)) },
          ...(field.showIf === undefined
            ? []
            : [
                {
                  key: 'showIf',
                  value: this.#condition(node, field, fields.slice(0, index)),
                },
              ]),
        ]),
      ),
    );
  }

  /**
   * A conditional field, flattened to the answer it
   * watches.
   *
   * The page evaluates this in a browser against
   * the answers already filled in, and those are
   * one value per field — so the path has to name
   * one field, and a field asked before this one,
   * or there is nothing there to read.
   */
  #condition(
    node: WorkflowNode,
    field: FormField,
    earlier: readonly FormField[],
  ): Emitted {
    const showIf = field.showIf;
    if (showIf === undefined) return object([]);

    const [only, ...rest] = showIf.path.split('.');

    if (
      only === undefined ||
      rest.length > 0 ||
      !earlier.some((each) => each.id === only)
    ) {
      throw new UnsupportedIR(
        `\`${field.id}\` is shown only when \`${showIf.path}\` holds, but ` +
          `a form's answers are one value per field and \`${showIf.path}\` ` +
          `does not name a field asked before it.`,
        node.id,
      );
    }

    return object([
      { key: 'fieldId', value: source(literal(only)) },
      { key: 'op', value: source(literal(showIf.op)) },
      ...(showIf.value === undefined
        ? []
        : [{ key: 'value', value: source(literal(showIf.value)) }]),
    ]);
  }

  /** What the page after this email lists as still
   *  to come, which is what its wait leads to. */
  #downstreamOf(node: WorkflowNode): Emitted {
    const waitId = this.#plan.waitForEmail.get(node.id);
    const titles =
      waitId === undefined ? [] : (this.#plan.downstream.get(waitId) ?? []);

    return titlesList(titles);
  }

  /** Whoever the email goes to. */
  #recipient(to: Recipient): string {
    return to === 'requestingUser' ? REQUESTER : literal(to);
  }

  /**
   * An approval: one block on the canvas, three
   * constructs in the file.
   *
   * It is sugar and it stays sugar — no pass
   * rewrites the document. The email carries an
   * ordinary form token scoped to this node, the
   * park is an ordinary wait on it, and the two
   * ways out are laid out exactly as a branch's
   * are.
   */
  #emitApproval(item: Extract<PlanItem, { kind: 'approval' }>): void {
    const node = item.node;
    if (node.kind !== 'approval') return;

    const config = node.config;
    const days = config.timeoutDays ?? DEFAULT_WAIT_DAYS;
    const seconds = days * SECONDS_PER_DAY;
    const local = this.#local(node);

    this.#want({
      specifier: '../app/mail.js',
      name: 'sendNodeEmail',
      type: false,
    });
    this.#want(waitsImport('registerWaitCorrelation'));
    this.#want(waitsImport('clearWaitCorrelation'));

    const retries = retriesOn(node.retry);
    if (retries) {
      this.#want({
        specifier: '../app/mailer.js',
        name: 'isTransientSendFailure',
        type: false,
      });
      this.#body.comment(
        'A retry can send a second copy when the provider accepted a ' +
          'request whose response was lost. A run that never sends its ' +
          'only link sleeps until its timeout, which is worse.',
      );
    }

    writeStep(this.#body, {
      head: 'await DBOS.runStep',
      call: call(
        'sendNodeEmail',
        object([
          { key: RUN_ID },
          { key: 'workflowTitle', value: source(literal(this.#title())) },
          { key: 'nodeId', value: source(literal(node.id)) },
          { key: 'to', value: source(this.#recipient(config.to)) },
          {
            key: 'subject',
            value: source(
              literal(config.subject ?? `Approval needed: ${node.title}`),
            ),
          },
          {
            key: 'bodyMarkdown',
            value: source(
              literal(
                config.message ??
                  `${this.#title()} is waiting on your decision.`,
              ),
            ),
          },
          {
            key: 'attach',
            value: object([
              { key: 'kind', value: source(literal('approval')) },
              { key: 'nodeId', value: source(literal(node.id)) },
              { key: 'expiresInSeconds', value: source(String(seconds)) },
            ]),
          },
          { key: 'downstream', value: titlesList(item.downstream) },
        ]),
      ),
      options: [
        `name: ${stepNameLiteral(node.id, this.#segments([{ kind: 'ask' }]))},`,
        ...retryOptions(node.retry),
        ...(retries ? ['shouldRetry: isTransientSendFailure,'] : []),
      ],
    });
    this.#body.blank();

    writeWait(this.#body, {
      local,
      type: APPROVAL_REPLY,
      topic: node.id,
      timeoutSeconds: seconds,
      why: [timeoutWhy(config.timeoutDays)],
      // A form wait in everything but the page it
      // opens: the email mints an ordinary form
      // token, which is the whole point of reusing
      // the form machinery for a decision.
      register: this.#registerStep(node, FORM_TOPIC, literal(node.id)),
      clear: this.#clearStep(node),
      onNothing: {
        kind: 'throw',
        problem: `${node.id}: nobody answered within ${daysText(days)}.`,
      },
    });
    this.#body.blank();

    this.#writeArms(local, item.arms);
  }

  /** The title the emails say this workflow is. */
  #title(): string {
    return this.#ir.title ?? this.#ir.name;
  }

  #nodeById(id: string, about: string): WorkflowNode {
    const node = this.#ir.nodes.find((each) => each.id === id);

    if (node === undefined) {
      throw new UnsupportedIR(
        `\`${about}\` names \`${id}\`, which is not a block in this ` +
          `workflow.`,
        about,
      );
    }

    return node;
  }

  #notAnEmail(node: WorkflowNode): UnsupportedIR {
    return new UnsupportedIR(
      `\`${node.id}\` is not an email, so it has nothing to send.`,
      node.id,
    );
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

    // Sharing the condition is what usually fixes
    // this, so a block that already shares it needs
    // to be told something else: the two are in one
    // block together only where they sit side by
    // side, and a loop or an unconditional block
    // between them ends that.
    const bound = this.#plan.chain.find((each) => each.id === producer);

    if (bound !== undefined && sameGuard(bound.guard, node.guard)) {
      return new UnsupportedIR(
        `\`${node.id}\` reads what \`${producer}\` produced under the ` +
          `same condition, but something between them put the two in ` +
          `separate blocks, so the value \`${producer}\` bound cannot ` +
          `be named where \`${node.id}\` runs.`,
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
    writeValue(
      writer,
      'export const waits: Record<string, WaitDescriptor> = ',
      this.#waitTable(),
      ';',
    );
    writer.blank();
    writeValue(
      writer,
      'export const eventWaits: EventWait[] = ',
      this.#eventWaitTable(),
      ';',
    );

    return writer.toString();
  }

  /**
   * Every wait a person can answer, by id.
   *
   * The form route looks a token's node up here and
   * this is the only thing that can tell it which
   * of the two pages to serve — the token itself
   * cannot say, by design. A wait on an event is
   * not here: nobody opens a page for it.
   */
  #waitTable(): Emitted {
    const entries: EmittedEntry[] = [];

    for (const node of this.#plan.chain) {
      if (node.kind === 'approval') {
        entries.push({
          key: node.id,
          value: object([
            ...this.#waitHeader(node),
            { key: 'page', value: source(literal('approval')) },
            { key: 'fields', value: list([]) },
            {
              key: 'downstream',
              value: titlesList(this.#plan.downstream.get(node.id) ?? []),
            },
          ]),
        });
        continue;
      }

      if (node.kind !== 'durableWait') continue;
      if (node.config.source.kind !== 'form') continue;

      const email = this.#nodeById(node.config.source.email, node.id);
      const fields =
        email.kind === 'emailSend' && email.config.attach.type === 'form'
          ? email.config.attach.form.fields
          : [];

      entries.push({
        key: node.id,
        value: object([
          ...this.#waitHeader(node),
          { key: 'page', value: source(literal('form')) },
          { key: 'fields', value: this.#fields(email, fields) },
          {
            key: 'downstream',
            value: titlesList(this.#plan.downstream.get(node.id) ?? []),
          },
        ]),
      });
    }

    return object(entries);
  }

  #waitHeader(node: WorkflowNode): EmittedEntry[] {
    return [
      { key: 'nodeId', value: source(literal(node.id)) },
      { key: 'title', value: source(literal(node.title)) },
    ];
  }

  /**
   * Every wait something outside sends to.
   *
   * The ingress route reads this to work out which
   * run an arriving event belongs to: the topic
   * says which wait, and the path says where in the
   * payload the value to match on is.
   */
  #eventWaitTable(): Emitted {
    const rows: Emitted[] = [];

    for (const node of this.#plan.chain) {
      if (node.kind !== 'durableWait') continue;

      const waitOn = node.config.source;
      if (waitOn.kind !== 'event') continue;

      rows.push(
        object([
          { key: 'nodeId', value: source(literal(node.id)) },
          { key: 'topic', value: source(literal(waitOn.topic)) },
          {
            key: 'correlationPath',
            value: source(literal(waitOn.correlationPath)),
          },
        ]),
      );
    }

    return list(rows);
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
 * A run's answer to an approval, as the type the
 * park is written against.
 *
 * Written out rather than imported: the shape is
 * the runtime's own reply to its approval page,
 * not anything the project's code-behind declares,
 * so there is no file it could come from.
 */
const APPROVAL_REPLY = '{ approved: boolean }';

/** The table every wait on a person registers in. */
const FORM_TOPIC = 'form';

function waitsImport(name: string): ImportEntry {
  return { specifier: '../app/waits.js', name, type: false };
}

/** Which table a message arrives on. */
function topicOf(waitOn: WaitSource): string {
  return waitOn.kind === 'event' ? waitOn.topic : FORM_TOPIC;
}

/** Whether a step is allowed more than one go. */
function retriesOn(retry: Retry | undefined): boolean {
  return (retry ?? DEFAULT_RETRY).maxAttempts !== 1;
}

/** A number of days, as a reader would say it. */
function daysText(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Why the emitted file names the number of seconds
 * it does.
 *
 * A wait that named its own limit needs only the
 * unit spelled out. One that named none is being
 * given a limit it never asked for, and the file
 * should say where that came from.
 */
function timeoutWhy(days: number | undefined): string {
  if (days !== undefined) return `${daysText(days)}, as seconds.`;

  return (
    'Seven days, as seconds. This wait set no limit of its own, and the ' +
    'minute the SDK would wait instead is not what anybody means by ' +
    'waiting for a person.'
  );
}

/** Titles, as the list the runtime reads. */
function titlesList(titles: readonly string[]): Emitted {
  return list(titles.map((title) => source(literal(title))));
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
