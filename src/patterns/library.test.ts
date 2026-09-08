import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileWorkflow,
  determinismProblems,
  headerProblems,
  placementProblems,
  queueProblems,
  registrationProblems,
  stepProblems,
} from '../compile/index.js';
import { NodeKindSchema } from '../ir/index.js';
import { scanLib, type LibManifest } from '../manifest/index.js';
import { expectGolden } from '../test-support/fixtures.js';
import { validateWorkflow } from '../validate/index.js';

import { listPatterns, type WorkflowPattern } from './index.js';

/**
 * Every pattern the gallery offers, held to the
 * same bar a project's own workflow is held to.
 *
 * A pattern is the one workflow a person never
 * drew, so nothing about it has been through a
 * canvas, a validation run or a compile before it
 * ships. This suite is that run: it iterates the
 * library rather than naming one pattern, so a
 * pattern added later is covered by being added.
 */

const LIBRARY_DIR = join(import.meta.dirname, 'library');

/** Never read by the hero, which has no schedule.
 *  Named anyway because compiling requires it, and
 *  a zone read off the machine would bless a
 *  golden CI could not reproduce. */
const TIMEZONE = 'America/Los_Angeles';

const PATTERNS = listPatterns();

/**
 * Each pattern's own code-behind, scanned once.
 * The scan is the slow part of this file and four
 * assertions ask it the same question.
 */
const MANIFESTS = new Map<string, LibManifest>(
  PATTERNS.map((pattern) => [
    pattern.name,
    scanLib(join(LIBRARY_DIR, pattern.name, 'lib')),
  ]),
);

function manifestOf(pattern: WorkflowPattern): LibManifest {
  const manifest = MANIFESTS.get(pattern.name);
  if (manifest === undefined) throw new Error(`unscanned: ${pattern.name}`);

  return manifest;
}

describe('the pattern library', () => {
  it('offers exactly the patterns that are on disk', () => {
    const onDisk = readdirSync(LIBRARY_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    // Non-vacuous: an empty library would make
    // every assertion below pass by never running.
    expect(onDisk).not.toHaveLength(0);
    expect(PATTERNS.map((pattern) => pattern.name)).toEqual(onDisk);
  });

  it('carries at most one pattern marked as the demonstration', () => {
    // The flag says "open this one to show someone
    // what mBoss is", and two of those is nobody's
    // answer to that question.
    const demos = PATTERNS.filter((pattern) => pattern.meta.demo === true);

    expect(demos.length).toBeLessThanOrEqual(1);
  });

  it('never lets two patterns claim the same handler or type name', () => {
    // Two patterns used in one project share a
    // `lib/`, and the manifest keys types by name
    // alone: a second `Purchase` would take the
    // first one's place and the workflow that
    // named it would import from the wrong file.
    const claimedBy = new Map<string, string>();
    const clashes: string[] = [];

    for (const pattern of PATTERNS) {
      const manifest = manifestOf(pattern);
      const claimed = [
        ...manifest.functions.map((fn) => fn.export),
        ...manifest.types,
      ];

      for (const name of claimed) {
        const owner = claimedBy.get(name);
        if (owner !== undefined && owner !== pattern.name) {
          clashes.push(`${name}: ${owner} and ${pattern.name}`);
        }
        claimedBy.set(name, pattern.name);
      }
    }

    expect(clashes).toEqual([]);
  });
});

describe.each(PATTERNS.map((pattern) => [pattern.name, pattern] as const))(
  'the %s pattern',
  (name, pattern) => {
    const { document } = pattern;
    const manifest = manifestOf(pattern);

    it('is a first revision with nothing laid out', () => {
      // A pattern arrives as though it had just
      // been created, and where its blocks sit is
      // the first thing its new owner decides.
      expect(document.revision).toBe(1);
      expect(
        document.nodes.filter((node) => node.position !== undefined),
      ).toEqual([]);
    });

    it('has exactly one trigger', () => {
      const triggers = document.nodes.filter((node) => node.kind === 'trigger');

      expect(triggers).toHaveLength(1);
    });

    it('draws only block kinds the catalog knows', () => {
      // Here rather than beside the catalog because
      // this is where a library drawn against a
      // kind the catalog does not offer yet would
      // surface.
      for (const node of document.nodes) {
        expect(NodeKindSchema.options).toContain(node.kind);
      }
    });

    it('shows the four kinds the document reaches first', () => {
      const distinct = [...new Set(document.nodes.map((node) => node.kind))];

      expect(pattern.meta.glyphs).toEqual(distinct.slice(0, 4));
    });

    it('takes its title from the document rather than its own copy', () => {
      expect(pattern.title).toBe(document.title);
    });

    it('scans its code-behind without a single error', () => {
      expect(manifest.errors).toEqual([]);
    });

    it('leaves validation with nothing at all to report', () => {
      // Nothing, not merely no errors: a pattern
      // ships with its warnings already answered,
      // because the person who opens it did not
      // draw whatever the warning is about.
      expect(validateWorkflow(document, { manifest })).toEqual([]);
    });

    it('compiles, and matches its blessed output', () => {
      expectGolden(`golden/patterns/${name}.workflow.ts`, compiled(pattern));
    });

    it('emits a file that passes every audit', () => {
      const source = compiled(pattern);

      expect(headerProblems(source, name)).toEqual([]);
      expect(registrationProblems(source, name)).toEqual([]);
      expect(stepProblems(source)).toEqual([]);
      expect(placementProblems(source)).toEqual([]);
      expect(determinismProblems(source)).toEqual([]);
      expect(queueProblems(source)).toEqual([]);
    });
  },
);

/**
 * A pattern's emitted workflow file, against its
 * own code-behind. Compiling against the fixture
 * `lib/` instead would put the pattern's types
 * into a manifest golden that has nothing to do
 * with it.
 */
function compiled(pattern: WorkflowPattern): string {
  const result = compileWorkflow({
    ir: pattern.document,
    manifest: manifestOf(pattern),
    timezone: TIMEZONE,
  });

  if (!result.ok) {
    throw new Error(
      `${pattern.name} did not compile: ` +
        JSON.stringify(result, null, 2).slice(0, 2000),
    );
  }

  return result.source;
}
