import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import type { Type } from 'ts-morph';
import {
  ModuleKind,
  ModuleResolutionKind,
  Project,
  ScriptTarget,
} from 'ts-morph';
import { describe, expect, it } from 'vitest';

import { nonSerializableMembers } from './serializable.js';
import type { NonSerializable } from './types.js';

/**
 * The samples below are written against Node's
 * globals and its stream and socket types, the way
 * a real code-behind is, so this project reads the
 * same declarations a scan reads.
 */
const NODE_TYPE_ROOT = dirname(
  dirname(createRequire(import.meta.url).resolve('@types/node/package.json')),
);

function newProject(): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: ScriptTarget.ES2023,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ['node'],
      typeRoots: [NODE_TYPE_ROOT],
    },
  });
}

const project = newProject();

let samples = 0;

/**
 * The declared type of `Sample` in one source
 * sample.
 *
 * Each sample is its own file, so a helper type
 * declared in one cannot leak into the next.
 */
function sampleType(source: string): Type {
  samples += 1;
  const file = project.createSourceFile(`/samples/${samples}.ts`, source);
  const declaration =
    file.getInterface('Sample') ??
    file.getTypeAlias('Sample') ??
    file.getClass('Sample');

  if (!declaration) throw new Error('this sample declares no `Sample`');

  return declaration.getType();
}

function findings(source: string): NonSerializable[] {
  return nonSerializableMembers('Sample', sampleType(source));
}

/**
 * A sample whose one member `m` has the named
 * type, imported from `from` when it is not a
 * global.
 */
function memberOf(name: string, from?: string): NonSerializable[] {
  const imported =
    from === undefined ? '' : `import type { ${name} } from '${from}';\n`;

  return findings(`${imported}export interface Sample { m: ${name} }`);
}

/**
 * The same, for a name that is not Node's: the
 * database clients are classified by what they are
 * called, so a local interface of that name is
 * enough to show the classification is by name.
 */
function localMemberOf(name: string): NonSerializable[] {
  return findings(
    `interface ${name} { size: number }\n` +
      `export interface Sample { m: ${name} }`,
  );
}

describe('nonSerializableMembers', () => {
  it('reports a function member, at the name that holds it', () => {
    expect(findings('export interface Sample { onDone: () => void }')).toEqual([
      { type: 'Sample', path: 'onDone', reason: 'function' },
    ]);
  });

  it('reports a Buffer', () => {
    expect(findings('export interface Sample { body: Buffer }')).toEqual([
      { type: 'Sample', path: 'body', reason: 'buffer' },
    ]);
  });

  it.each([
    ['Readable', 'node:stream'],
    ['Writable', 'node:stream'],
    ['Duplex', 'node:stream'],
    ['Transform', 'node:stream'],
    ['ReadableStream', undefined],
    ['WritableStream', undefined],
    ['TransformStream', undefined],
  ])('reports a %s as a stream', (name, from) => {
    expect(memberOf(name, from)).toEqual([
      { type: 'Sample', path: 'm', reason: 'stream' },
    ]);
  });

  it.each([
    ['Socket', 'node:net'],
    ['Server', 'node:net'],
    ['FileHandle', 'node:fs/promises'],
    ['ClientRequest', 'node:http'],
    ['AbortController', undefined],
  ])('reports a %s as a live handle', (name, from) => {
    expect(memberOf(name, from)).toEqual([
      { type: 'Sample', path: 'm', reason: 'handle' },
    ]);
  });

  it.each(['Pool', 'Client', 'PrismaClient'])(
    'reports a %s as a live handle, by its name alone',
    (name) => {
      expect(localMemberOf(name)).toEqual([
        { type: 'Sample', path: 'm', reason: 'handle' },
      ]);
    },
  );

  it('reports a class that declares a method, as the type itself', () => {
    const source = [
      'export class Sample {',
      '  constructor(readonly id: string) {}',
      '  refresh(): void {}',
      '}',
    ].join('\n');

    expect(findings(source)).toEqual([
      { type: 'Sample', path: '', reason: 'class' },
    ]);
  });

  it('leaves a class of nothing but fields alone', () => {
    expect(findings('export class Sample { id = "" }')).toEqual([]);
  });

  it('names the whole dot-path to a member nested in an object', () => {
    expect(
      findings('export interface Sample { payload: { onDone: () => void } }'),
    ).toEqual([{ type: 'Sample', path: 'payload.onDone', reason: 'function' }]);
  });

  it('descends into an array’s element type', () => {
    expect(findings('export interface Sample { m: Buffer[] }')).toEqual([
      { type: 'Sample', path: 'm', reason: 'buffer' },
    ]);
  });

  it('descends into every member of a tuple', () => {
    expect(findings('export interface Sample { m: [string, Buffer] }')).toEqual(
      [{ type: 'Sample', path: 'm', reason: 'buffer' }],
    );
  });

  it('descends into every constituent of a union', () => {
    expect(
      findings('export interface Sample { m: string | (() => void) }'),
    ).toEqual([{ type: 'Sample', path: 'm', reason: 'function' }]);
  });

  it('descends into every constituent of an intersection', () => {
    // The offending half is only classifiable
    // whole: reading the intersection's own
    // members instead would report every method
    // the buffer happens to carry.
    expect(
      findings('export interface Sample { m: Buffer & { x: string } }'),
    ).toEqual([{ type: 'Sample', path: 'm', reason: 'buffer' }]);
  });

  it('names a member of an intersection by its own path', () => {
    const source = [
      'interface Named { name: string }',
      'export interface Sample { m: Named & { body: Buffer } }',
    ].join('\n');

    expect(findings(source)).toEqual([
      { type: 'Sample', path: 'm.body', reason: 'buffer' },
    ]);
  });

  it('accepts the values the workflow serializer already carries', () => {
    // DBOS serializes with SuperJSON, which
    // preserves Date, Map, Set, RegExp and BigInt.
    // This walk exists to catch behaviour and live
    // resources, not to relitigate the
    // serializer's own table of value types.
    const source = [
      'export interface Sample {',
      '  at: Date;',
      '  tags: string[];',
      '  ids: Map<string, number>;',
      '  seen: Set<string>;',
      '  match: RegExp;',
      '  size: bigint;',
      '}',
    ].join('\n');

    expect(findings(source)).toEqual([]);
  });

  it.each(['URL', 'Uint8Array', 'Promise<string>'])(
    'stops at %s rather than listing what it declares',
    (name) => {
      expect(memberOf(name)).toEqual([]);
    },
  );

  it.each(['Held', 'Partial<Held>', 'Readonly<Held>', 'Omit<Held, "id">'])(
    'walks the author’s own members through %s',
    (member) => {
      const source = [
        'interface Held { id: string; body: Buffer }',
        `export interface Sample { m: ${member} }`,
      ].join('\n');

      expect(findings(source)).toEqual([
        { type: 'Sample', path: 'm.body', reason: 'buffer' },
      ]);
    },
  );

  it('walks a type the project declares in a .d.ts of its own', () => {
    // A code-behind may carry ambient declarations
    // beside its handlers. Those types are the
    // author's, so being described rather than
    // written is not what stops the walk.
    project.createSourceFile(
      '/samples/ambient.d.ts',
      'interface Ambient { body: Buffer }',
    );

    expect(findings('export interface Sample { m: Ambient }')).toEqual([
      { type: 'Sample', path: 'm.body', reason: 'buffer' },
    ]);
  });

  it('stops at an installed type the project adds a member to', () => {
    // A code-behind that augments `Date` has added
    // one member to the standard library's
    // forty-five. Walking in to find it would
    // report all of them, so the added member is
    // the thing given up rather than the other way
    // round. Its own project: the augmentation is
    // global, and no other sample should see it.
    const own = newProject();
    own.createSourceFile(
      '/own/augment.d.ts',
      'declare global { interface Date { extra: Buffer } }\nexport {};',
    );
    const file = own.createSourceFile(
      '/own/sample.ts',
      'export interface Sample { m: Date }',
    );
    const declared = file.getInterfaceOrThrow('Sample').getType();

    expect(nonSerializableMembers('Sample', declared)).toEqual([]);
  });

  it('says nothing about a member the compiler named itself', () => {
    const source = [
      'export interface Sample {',
      '  [Symbol.iterator](): Iterator<string>;',
      '}',
    ].join('\n');

    expect(findings(source)).toEqual([]);
  });

  it('terminates on a type that contains itself', () => {
    expect(findings('export interface Sample { next: Sample }')).toEqual([]);
  });

  it('reports a self-containing type’s bad member once, not per lap', () => {
    const source = [
      'export interface Sample {',
      '  next: Sample;',
      '  onDone: () => void;',
      '}',
    ].join('\n');

    expect(findings(source)).toEqual([
      { type: 'Sample', path: 'onDone', reason: 'function' },
    ]);
  });

  it('reports a member eight levels down', () => {
    expect(findings(nested(8))).toEqual([
      { type: 'Sample', path: `${'a.'.repeat(7)}onDone`, reason: 'function' },
    ]);
  });

  it('stops rather than descending past eight levels', () => {
    expect(findings(nested(9))).toEqual([]);
  });
});

/**
 * A sample whose function member sits exactly
 * `depth` names below `Sample`.
 */
function nested(depth: number): string {
  let inner = 'onDone: () => void';

  for (let level = 1; level < depth; level += 1) inner = `a: { ${inner} }`;

  return `export interface Sample { ${inner} }`;
}
