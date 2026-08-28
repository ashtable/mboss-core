import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema, type WorkflowIR } from '../ir/index.js';
import { LibManifestSchema, type LibManifest } from '../manifest/index.js';
import { readFixtureJson } from '../test-support/fixtures.js';
import { makeIR } from '../test-support/ir.js';

import { canCompile, hasErrors, validateWorkflow } from './index.js';

function fixture(name: string): WorkflowIR {
  return WorkflowIRSchema.parse(readFixtureJson(`ir/${name}.workflow.json`));
}

/**
 * The blessed scan of the fixture code-behind,
 * which is the code the canonical workflow's nodes
 * name. It carries no `scannedAt` — that is an
 * instant, and a golden cannot hold one — so the
 * one field the schema needs is supplied here.
 */
function libManifest(): LibManifest {
  return LibManifestSchema.parse({
    scannedAt: '2026-01-01T00:00:00.000Z',
    ...readFixtureJson<Record<string, unknown>>(
      'golden/manifest/lib.manifest.json',
    ),
  });
}

describe('validateWorkflow', () => {
  it('finds nothing wrong with the canonical workflow', () => {
    expect(validateWorkflow(fixture('groom_booking'))).toEqual([]);
  });

  it('still finds nothing wrong once the code-behind is there to check against', () => {
    const found = validateWorkflow(fixture('groom_booking'), {
      manifest: libManifest(),
    });

    expect(found).toEqual([]);
  });

  it('reports an empty draft as one warning and nothing else', () => {
    const found = validateWorkflow(fixture('empty_draft'));

    expect(found).toEqual([
      {
        code: 'V01',
        severity: 'warning',
        message: expect.any(String),
      },
    ]);
    expect(hasErrors(found)).toBe(false);
  });

  /**
   * The apply gate is deliberately looser than the
   * compile gate: a draft with no trigger yet
   * saves and draws, and only fails to compile.
   * Adding the trigger last is an ordinary order
   * of work, so nothing in a trigger-less draft
   * may become an error.
   */
  it('keeps a trigger-less draft saveable even when it writes to the requester', () => {
    const ir = makeIR({
      nodes: [
        {
          id: 'confirm',
          kind: 'emailSend',
          config: {
            to: 'requestingUser',
            subject: 'Confirmed',
            bodyMarkdown: 'Done',
            attach: { type: 'none' },
          },
        },
      ],
    });
    const found = validateWorkflow(ir);

    expect(found.map((diagnostic) => diagnostic.code)).toEqual(['V01']);
    expect(hasErrors(found)).toBe(false);
  });
});

describe('canCompile', () => {
  it('lets the canonical workflow through', () => {
    const ir = fixture('groom_booking');

    const found = validateWorkflow(ir, { manifest: libManifest() });

    expect(canCompile(ir, found)).toBe(true);
  });

  it('holds back a draft with no trigger', () => {
    const ir = fixture('empty_draft');

    expect(canCompile(ir, validateWorkflow(ir))).toBe(false);
  });

  it('holds back a step whose handler does not exist yet, warning though it is', () => {
    // The apply gate and the compile gate differ
    // here on purpose: a block drawn before its
    // code is a normal thing to save, and an
    // impossible thing to generate a call to.
    const ir = makeIR({
      nodes: [
        { id: 'start', kind: 'trigger', config: { mode: 'manual' } },
        { id: 'work' },
      ],
      edges: [{ from: 'start', to: 'work' }],
    });
    const found = validateWorkflow(ir);

    expect(found.map((diagnostic) => diagnostic.code)).toEqual(['V07']);
    expect(hasErrors(found)).toBe(false);
    expect(canCompile(ir, found)).toBe(false);
  });
});
