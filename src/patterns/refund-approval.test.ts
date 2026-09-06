import { describe, expect, it } from 'vitest';

import {
  compileWorkflow,
  determinismProblems,
  headerProblems,
  placementProblems,
  planWorkflow,
  registrationProblems,
  stepProblems,
  type CompileResult,
} from '../compile/index.js';
import {
  WorkflowIRSchema,
  type WorkflowIR,
  type WorkflowNode,
} from '../ir/index.js';
import type { LibManifest } from '../manifest/index.js';
import { expectGolden } from '../test-support/fixtures.js';
import { validateWorkflow } from '../validate/index.js';

import { patternNamed } from './index.js';

/**
 * What this compiler does with blocks that two
 * ways out of a fork both lead to.
 *
 * The refund pattern is the drawing the question
 * arises in: a branch and an approval both end at
 * the same three closing blocks, and one arm meets
 * the others below. Whether that compiles turns on
 * what sits between the fork and the shared block,
 * and the four answers are not ones a person
 * drawing it would guess. So the shapes are
 * written out here side by side — the pattern as
 * it ships, and four small edits of it — and each
 * one says what it gets back.
 *
 * Only the first is a pattern. The other four are
 * built in memory, because a gallery of workflows
 * that do not compile is not a gallery, and two of
 * them are documents the compiler turns down.
 */

/** Never read by these documents, none of which is
 *  scheduled. Named anyway because compiling
 *  requires it, and a zone off the machine would
 *  bless a golden CI could not reproduce. */
const TIMEZONE = 'America/Los_Angeles';

const HERO = heroDocument();

/**
 * The pattern's code-behind as a scan of it
 * reports, plus the one handler the edited shapes
 * need.
 *
 * Written out rather than scanned because
 * `recordReview` has no file in the pattern's
 * `lib/` and must not get one: nothing the gallery
 * ships calls it, and a pattern carrying a handler
 * for a block it does not draw is a pattern with a
 * dead file in it. What keeps the four copied
 * entries honest is the first shape below, which
 * compiles through this manifest and is compared
 * against the golden the scanned one produces.
 */
const MANIFEST: LibManifest = {
  scannedAt: '2026-01-01T00:00:00.000Z',
  sourceHash: 'the-join-suite-does-not-cache',
  functions: [
    {
      export: 'getPurchase',
      file: 'lib/getPurchase.ts',
      params: [{ name: 'request', type: 'RefundRequest' }],
      returnType: 'Purchase',
    },
    {
      export: 'refundPolicy',
      file: 'lib/refundPolicy.ts',
      params: [{ name: 'purchase', type: 'Purchase' }],
      returnType: 'RefundVerdict',
      decision: ['auto_approve', 'review'],
    },
    {
      export: 'refundPayment',
      file: 'lib/refundPayment.ts',
      params: [{ name: 'purchase', type: 'Purchase' }],
      returnType: 'RefundResult',
    },
    {
      export: 'markRefunded',
      file: 'lib/markRefunded.ts',
      params: [{ name: 'result', type: 'RefundResult' }],
      returnType: 'Order',
    },
    {
      export: 'recordReview',
      file: 'lib/recordReview.ts',
      params: [{ name: 'purchase', type: 'Purchase' }],
      returnType: 'Purchase',
    },
  ],
  types: [
    'Order',
    'Purchase',
    'RefundRequest',
    'RefundResult',
    'RefundVerdict',
  ],
  typeSources: {
    Order: 'lib/refundApprovalTypes.ts',
    Purchase: 'lib/refundApprovalTypes.ts',
    RefundRequest: 'lib/refundApprovalTypes.ts',
    RefundResult: 'lib/refundApprovalTypes.ts',
    RefundVerdict: 'lib/refundApprovalTypes.ts',
  },
  nonSerializable: [],
  errors: [],
};

/** The three blocks both ways out of the fork end
 *  at, which is what all five shapes are about. */
const SHARED = ['refund_payment', 'update_order', 'email_customer'];

/**
 * A wire without its id.
 *
 * The schema takes only `e<number>`, so ids are
 * handed out by the builder in wire order rather
 * than written into each shape, where they would
 * be four more things to keep unique by hand.
 */
type Wire = {
  from: { node: string; port?: string };
  to: string;
  type?: string;
};

const HERO_WIRES: readonly Wire[] = HERO.edges.map((edge) => ({
  from: edge.from,
  to: edge.to.node,
  ...(edge.type === undefined ? {} : { type: edge.type }),
}));

/**
 * A block bound on the approved arm, above the
 * shared blocks.
 *
 * A transaction because that is the honest shape
 * of it — a note written to the database saying
 * who decided — and because it binds a value,
 * which is the whole question these shapes ask.
 */
const RECORD_REVIEW = {
  id: 'record_review',
  kind: 'transaction',
  title: 'Record review',
  handler: { export: 'recordReview' },
  in: 'Purchase',
  out: 'Purchase',
  config: {},
};

describe('the pattern as it ships', () => {
  it('leaves validation with nothing to report', () => {
    expect(validateWorkflow(HERO, { manifest: MANIFEST })).toEqual([]);
  });

  /**
   * Compiled through the manifest written out
   * above rather than through a scan of `lib/`,
   * and compared against the golden the scan
   * produces: the two agreeing byte for byte is
   * what makes the copied entries evidence about
   * the shipped pattern rather than about
   * themselves.
   */
  it('compiles to the same file its own code-behind produces', () => {
    expectGolden('golden/patterns/refund_approval.workflow.ts', sourceOf(HERO));
  });

  it('emits a file that passes every audit', () => {
    const source = sourceOf(HERO);

    expect(headerProblems(source, HERO.name)).toEqual([]);
    expect(registrationProblems(source, HERO.name)).toEqual([]);
    expect(stepProblems(source)).toEqual([]);
    expect(placementProblems(source)).toEqual([]);
    expect(determinismProblems(source)).toEqual([]);
  });
});

describe('the shared blocks copied onto each arm', () => {
  const ir = eachArmItsOwnCopy();

  it('leaves validation with nothing to report', () => {
    expect(validateWorkflow(ir, { manifest: MANIFEST })).toEqual([]);
  });

  /**
   * This is the remedy the refusal further down
   * names, so it has to be a shape that works: an
   * author told to copy the blocks onto each arm
   * and then refused again would be worse off than
   * before they were told anything.
   */
  it('compiles, and each arm calls the same handlers', () => {
    const source = sourceOf(ir);

    // One handler, called on both arms, under two
    // recorded names — which is the copy the
    // refusal asks for, and why it is a copy of the
    // blocks rather than of the code behind them.
    expect(source.split('refundPayment(')).toHaveLength(3);
    expect(source).toContain("name: 'refund_payment_auto'");
    expect(source).toContain("name: 'refund_payment_review'");
    expect(stepProblems(source)).toEqual([]);
    expect(determinismProblems(source)).toEqual([]);
  });
});

describe('a block bound on one arm above the shared blocks', () => {
  const ir = reviewRecorded({ refundPaymentDeclaresIn: true });

  it('leaves validation with nothing to report', () => {
    // The refusal below is the compiler's, not a
    // rule's. Nothing about this drawing is
    // invalid; it is legal and unemittable, which
    // is the only reason the compiler has to say
    // anything at all.
    expect(validateWorkflow(ir, { manifest: MANIFEST })).toEqual([]);
  });

  it('is refused, naming both blocks the value could come from', () => {
    const message = refusalFor(ir);

    expect(message).toContain('load_purchase');
    expect(message).toContain('record_review');
  });
});

/**
 * The shape above with one line of the document
 * taken out: `refund_payment` no longer says what
 * it reads. Nothing else moves, and the compiler
 * goes from turning the drawing down to emitting a
 * file for it — a file that is wrong.
 *
 * These three tests pin that rather than fix it.
 * Running the same producer check over every block
 * that binds a value, instead of only over blocks
 * that declare an input, does close the hole; it
 * also turns down the ordinary shape of two arms
 * meeting again at a block that reads nothing,
 * which is drawn all over this repository's own
 * fixtures. Closing it without that cost means the
 * check knowing how many parameters a handler
 * takes, and that is a larger change than this
 * one. Until then, what the compiler does is
 * written down here, so that nobody reads its
 * silence as agreement.
 */
describe('that same shape with the input left undeclared', () => {
  const ir = reviewRecorded({ refundPaymentDeclaresIn: false });

  it('compiles', () => {
    expect(compile(ir).ok).toBe(true);
  });

  it('hands the payment the value from before the fork', () => {
    expect(planWorkflow(ir).producers.get('refund_payment')).toBe(
      'load_purchase',
    );
    expect(sourceOf(ir)).toContain('refundPayment(loadPurchaseOut)');
  });

  it('throws away what the approved arm produced', () => {
    const source = sourceOf(ir);

    // Bound, and then named nowhere else in the
    // file: the value the arm produced is written
    // and dropped on the floor.
    expect(source).toContain('const recordReviewOut = ');
    expect(source.split('recordReviewOut')).toHaveLength(2);
  });
});

describe('an arm meeting the others below where they meet', () => {
  const ir = denialRejoining();

  it('leaves validation with nothing to report', () => {
    expect(validateWorkflow(ir, { manifest: MANIFEST })).toEqual([]);
  });

  /**
   * The denial arm now ends at the closing email,
   * which the approved arm already passes through
   * on its way there. A walk that wrote the shared
   * blocks once for the approved arm arrives at
   * them again for the run that came the other
   * way, and writing them twice would run them
   * twice.
   */
  it('is refused, naming the block that would run twice', () => {
    expect(refusalFor(ir)).toContain('runs more than once');
  });
});

/**
 * Each way out of the fork with its own copies of
 * the three closing blocks, wired to the same
 * handlers.
 */
function eachArmItsOwnCopy(): WorkflowIR {
  const arms = [
    { suffix: 'auto', from: { node: 'evaluate_refund', port: 'auto_approve' } },
    { suffix: 'review', from: { node: 'request_approval', port: 'approved' } },
  ];

  const nodes: unknown[] = HERO.nodes.filter(
    (node) => !SHARED.includes(node.id),
  );
  const wires: Wire[] = HERO_WIRES.filter((wire) => !SHARED.includes(wire.to));

  for (const arm of arms) {
    for (const id of SHARED) {
      nodes.push({ ...heroNode(id), id: `${id}_${arm.suffix}` });
    }

    wires.push(
      {
        from: arm.from,
        to: `refund_payment_${arm.suffix}`,
        type: 'Purchase',
      },
      {
        from: { node: `refund_payment_${arm.suffix}` },
        to: `update_order_${arm.suffix}`,
        type: 'RefundResult',
      },
      {
        from: { node: `update_order_${arm.suffix}` },
        to: `email_customer_${arm.suffix}`,
        type: 'Order',
      },
    );
  }

  return documentOf(nodes, wires);
}

/**
 * The pattern with a block that writes down who
 * decided, on the approved arm, above the payment.
 *
 * `refundPaymentDeclaresIn` is the one line that
 * separates the refusal from the silence.
 */
function reviewRecorded(options: {
  refundPaymentDeclaresIn: boolean;
}): WorkflowIR {
  const nodes: unknown[] = HERO.nodes.map((node) => {
    if (node.id !== 'refund_payment' || options.refundPaymentDeclaresIn) {
      return node;
    }

    // Dropped rather than set to undefined: the
    // shapes differ by whether the document says
    // anything at all here, and a key present with
    // no value is not the same document.
    const saysNothing: Record<string, unknown> = { ...node };
    delete saysNothing.in;

    return saysNothing;
  });

  nodes.push(RECORD_REVIEW);

  const wires: Wire[] = HERO_WIRES.filter(
    (wire) =>
      wire.from.node !== 'request_approval' || wire.to !== 'refund_payment',
  );

  wires.push(
    {
      from: { node: 'request_approval', port: 'approved' },
      to: 'record_review',
      type: 'Purchase',
    },
    { from: { node: 'record_review' }, to: 'refund_payment', type: 'Purchase' },
  );

  return documentOf(nodes, wires);
}

/** The pattern with the denial arm carrying on to
 *  the email the other arm already sends. */
function denialRejoining(): WorkflowIR {
  return documentOf(HERO.nodes, [
    ...HERO_WIRES,
    { from: { node: 'email_denial' }, to: 'email_customer' },
  ]);
}

/**
 * One of the edited shapes as a document, through
 * the real schema — so a shape built here can
 * never be one that could not exist on disk.
 */
function documentOf(
  nodes: readonly unknown[],
  wires: readonly Wire[],
): WorkflowIR {
  return WorkflowIRSchema.parse({
    ...HERO,
    nodes,
    edges: wires.map((wire, index) => ({
      id: `e${index + 1}`,
      from: wire.from,
      to: { node: wire.to },
      ...(wire.type === undefined ? {} : { type: wire.type }),
    })),
  });
}

function heroDocument(): WorkflowIR {
  const pattern = patternNamed('refund_approval');

  if (pattern === undefined) {
    throw new Error('the refund approval pattern is not in the library');
  }

  return pattern.document;
}

function heroNode(id: string): WorkflowNode {
  const node = HERO.nodes.find((each) => each.id === id);

  if (node === undefined) {
    throw new Error(`the refund approval pattern draws no \`${id}\``);
  }

  return node;
}

function compile(ir: WorkflowIR): CompileResult {
  return compileWorkflow({ ir, manifest: MANIFEST, timezone: TIMEZONE });
}

/**
 * The generated file, or a failure that says what
 * went wrong. A bare `result.source` on a document
 * that did not compile reads as `undefined` three
 * assertions later.
 */
function sourceOf(ir: WorkflowIR): string {
  const result = compile(ir);

  if (!result.ok) {
    throw new Error(
      `did not compile: ${JSON.stringify(result, null, 2).slice(0, 2000)}`,
    );
  }

  return result.source;
}

/**
 * The sentence the compiler turned a document down
 * with.
 *
 * A document that quietly compiled fails here,
 * rather than further along on an assertion about
 * a message that was never produced.
 */
function refusalFor(ir: WorkflowIR): string {
  const result = compile(ir);

  if (result.ok || result.reason !== 'UNSUPPORTED') {
    const got = JSON.stringify(result, null, 2).slice(0, 2000);

    throw new Error(`expected a refusal, got ${got}`);
  }

  return result.message;
}
