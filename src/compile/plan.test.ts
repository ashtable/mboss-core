import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { readFixtureJson } from '../test-support/fixtures.js';

import {
  planWorkflow,
  type PlanArm,
  type PlanItem,
  type PlanRegion,
} from './plan.js';

/**
 * What the planner decides, asked of the planner.
 *
 * Most of what it works out is visible in the
 * emitted file and pinned by a golden, and that is
 * the right place for the shape of the output. A
 * loop's membership is not. Two documents that
 * disagree about which blocks a loop holds can
 * emit the same file right up until the day one of
 * them is refused — and then the refusal names a
 * block a reader cannot find in the loop it names.
 * So what is asked here is what a golden cannot
 * ask: which blocks a loop holds, and whether a
 * document plans at all.
 */

type Repeat = Extract<PlanItem, { kind: 'repeat' }>;

function fixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

/** The blocks in a region, in the order they run. */
function idsIn(region: PlanRegion): string[] {
  return region.flatMap((item) => {
    switch (item.kind) {
      case 'blocks':
        return item.group.nodes.map((node) => node.id);
      case 'branch':
      case 'approval':
        return [item.node.id, ...armIds(item.arms)];
      case 'countedLoop':
        return [item.node.id, ...idsIn(item.body)];
      case 'repeat':
        return idsIn(item.body);
    }
  });
}

function armIds(arms: readonly PlanArm[]): string[] {
  return arms.flatMap((arm) =>
    arm.target.kind === 'region' ? idsIn(arm.target.region) : [],
  );
}

/** Every loop that closes with a back edge, outermost first. */
function repeatsIn(region: PlanRegion): Repeat[] {
  return region.flatMap((item) => {
    switch (item.kind) {
      case 'repeat':
        return [item, ...repeatsIn(item.body)];
      case 'countedLoop':
        return repeatsIn(item.body);
      case 'branch':
      case 'approval':
        return item.arms.flatMap((arm) =>
          arm.target.kind === 'region' ? repeatsIn(arm.target.region) : [],
        );
      case 'blocks':
        return [];
    }
  });
}

describe('a loop that closes with a back edge', () => {
  it('holds the blocks between its entry and the branch that closes it', () => {
    const [loop, ...rest] = repeatsIn(
      planWorkflow(fixture('slot_retry_continue')).region,
    );

    expect(rest).toEqual([]);
    expect(loop?.entry.id).toBe('find_slot');
    expect(loop?.branch.id).toBe('look_again');
    expect(idsIn(loop?.body ?? [])).toEqual(['find_slot', 'look_again']);
  });
});

describe('a loop drawn inside another loop', () => {
  const plan = planWorkflow(fixture('slot_retry_rechecked'));

  it('plans both loops, one inside the other', () => {
    const [outer, inner, ...rest] = repeatsIn(plan.region);

    expect(rest).toEqual([]);
    expect([outer?.entry.id, outer?.branch.id]).toEqual([
      'parse_request',
      'still_ok',
    ]);
    expect([inner?.entry.id, inner?.branch.id]).toEqual([
      'find_slot',
      'look_again',
    ]);
  });

  /**
   * The blocks ahead of the inner loop's entry are
   * the whole point of this fixture. `parse_request`
   * and `has_a_time` sit between the outer loop's
   * entry and the inner one's, and a run arrives
   * back at them only by going round the outer
   * loop. That is not a way *ahead* from the inner
   * entry, so it is not a way the inner loop can
   * be left — and `has_a_time`'s second wire is
   * the outer loop's way out, not a second way out
   * of the inner one.
   */
  it('leaves the blocks before its entry to the loop that holds them', () => {
    const [outer, inner] = repeatsIn(plan.region);

    expect(idsIn(outer?.body ?? [])).toEqual([
      'parse_request',
      'has_a_time',
      'find_slot',
      'look_again',
      'still_ok',
    ]);
    expect(idsIn(inner?.body ?? [])).toEqual(['find_slot', 'look_again']);
  });

  it('carries each loop its own bound', () => {
    const [outer, inner] = repeatsIn(plan.region);

    expect([outer?.rounds, outer?.onExhausted]).toEqual([5, 'abort']);
    expect([inner?.rounds, inner?.onExhausted]).toEqual([10, 'continue']);
  });

  it('reads the value a block needs from the block that bound it', () => {
    expect(plan.producers.get('find_slot')).toBe('parse_request');
    expect(plan.producers.get('still_ok')).toBe('find_slot');
  });
});
