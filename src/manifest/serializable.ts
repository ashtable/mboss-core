import type { Symbol as TypeMember, Type } from 'ts-morph';
import { Node } from 'ts-morph';

import type { NonSerializable, NonSerializableReason } from './types.js';

/**
 * Which of a code-behind type's members cannot
 * survive the trip between two blocks.
 *
 * A workflow's values are written to the workflow
 * database on the way out of one block and read
 * back on the way into the next, so only data
 * makes it across. Behaviour does not: a function
 * comes back missing, a class instance comes back
 * as a plain object with its methods gone, and a
 * stream or an open connection was never a value
 * to begin with.
 *
 * A buffer is the one refusal here that is policy
 * rather than mechanism. The serializer does carry
 * one, as an array of bytes through the workflow
 * database — which is the wrong place for a
 * payload of unknown size. Bytes belong in the
 * artifact store, and a handler passes the key to
 * them.
 *
 * This runs while the parsed code is still in
 * hand. The manifest itself carries type names and
 * nothing else, so by the time a validation rule
 * reads it back out of JSON there is no structure
 * left to walk — which is exactly why the answer
 * is computed here and carried.
 */

/**
 * Stream types, by the name they are declared
 * under. Node's four and the web's three, which
 * arrive as globals.
 */
const STREAMS: ReadonlySet<string> = new Set([
  'Readable',
  'Writable',
  'Duplex',
  'Transform',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
]);

/**
 * Live resources: an open socket, file, server or
 * request, a database client, and the controller
 * that cancels work in this process.
 */
const HANDLES: ReadonlySet<string> = new Set([
  'Socket',
  'FileHandle',
  'Server',
  'ClientRequest',
  'Pool',
  'Client',
  'PrismaClient',
  'AbortController',
]);

/**
 * How far below the named type the walk looks.
 *
 * A payload nested deeper than this is past the
 * point where a diagnostic naming the dot-path
 * would help anyone, and the bound is what makes
 * the walk finish on a type the checker can expand
 * forever.
 */
const MAX_DEPTH = 8;

export function nonSerializableMembers(
  name: string,
  type: Type,
): NonSerializable[] {
  return walk(name, type, '', 0, new Set());
}

/**
 * One type, then whatever it is made of.
 *
 * `seen` holds the types on the way in, so a type
 * that contains itself stops at the second visit
 * rather than reporting the same member once per
 * lap.
 */
function walk(
  name: string,
  type: Type,
  path: string,
  depth: number,
  seen: ReadonlySet<Type>,
): NonSerializable[] {
  if (depth > MAX_DEPTH || seen.has(type)) return [];

  const reason = reasonFor(type);
  if (reason !== undefined) return [{ type: name, path, reason }];

  if (isOpaque(type)) return [];

  const inside = new Set(seen).add(type);
  const found: NonSerializable[] = [];

  for (const [member, memberType] of partsOf(type)) {
    found.push(
      ...walk(name, memberType, join(path, member), depth + 1, inside),
    );
  }

  return found;
}

/**
 * Why this type cannot travel, or `undefined` when
 * nothing about the type itself is wrong.
 *
 * The order is the order the tests run in and the
 * first match wins: a `Buffer` is a buffer rather
 * than the class it is declared as, and a database
 * client is a handle rather than a class with
 * methods.
 */
function reasonFor(type: Type): NonSerializableReason | undefined {
  if (
    type.getCallSignatures().length > 0 ||
    type.getConstructSignatures().length > 0
  ) {
    return 'function';
  }

  const name = type.getSymbol()?.getName();

  if (name === 'Buffer') return 'buffer';
  if (name !== undefined && STREAMS.has(name)) return 'stream';
  if (name !== undefined && HANDLES.has(name)) return 'handle';
  if (hasMethods(type)) return 'class';

  return undefined;
}

/**
 * Whether this type is a class that declares at
 * least one method.
 *
 * A class of nothing but fields survives the round
 * trip as the data it holds, which is what its
 * consumer was reading anyway. One method is where
 * that stops being true.
 */
function hasMethods(type: Type): boolean {
  return (type.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) =>
      Node.isClassDeclaration(declaration) &&
      declaration.getMethods().length > 0,
  );
}

/**
 * Whether the walk stops here.
 *
 * A primitive has nothing underneath it worth
 * naming, and asking the checker for its members
 * answers with the standard library's methods on
 * the boxed type instead.
 *
 * The walk stops at a type an installed package
 * declares too. DBOS uses SuperJSON, which preserves
 * `Date`, `Map`, `Set`, `RegExp` and `BigInt`; this
 * walk exists to catch behaviour and live
 * resources, not to relitigate the serializer's own
 * table of value types. Nor would there be anything
 * for the author to fix inside one: walking a `URL`
 * reports fifteen faults, every one of them naming
 * a method nobody wrote. What such a type is — a
 * stream, a handle, a class with methods — is
 * decided above, by name, before the walk gets
 * here.
 */
function isOpaque(type: Type): boolean {
  // A union, an intersection, an array and a tuple
  // are all made of other types, and it is those
  // that decide. An array is the standard library's
  // `Array` whatever it holds.
  if (
    type.isUnion() ||
    type.isIntersection() ||
    type.isArray() ||
    type.isTuple()
  ) {
    return false;
  }

  if (isInstalled(type)) return true;

  return (
    type.isString() ||
    type.isNumber() ||
    type.isBoolean() ||
    type.isBigInt() ||
    type.isNull() ||
    type.isUndefined() ||
    type.isVoid() ||
    type.isNever() ||
    type.isAny() ||
    type.isUnknown() ||
    type.isLiteral() ||
    type.isEnum()
  );
}

/**
 * Whether walking this type would land among an
 * installed package's members rather than the
 * author's.
 *
 * A code-behind lives inside the project, so a type
 * declared under `node_modules` came from a package
 * that was installed, or from the compiler's own
 * description of the language. One such declaration
 * is enough: a project that adds a member to `Date`
 * has added it to the standard library's forty-five,
 * and reporting those helps nobody.
 *
 * Being a `.d.ts` is not the test — a project may
 * declare its own types in one beside its handlers.
 */
function isInstalled(type: Type): boolean {
  const symbol = type.getSymbol();
  if (symbol === undefined) return false;

  // Only a type with a name of its own counts. A
  // name beginning with two underscores is one the
  // compiler made up for a shape that has none — an
  // inline object, or the mapped type behind
  // `Partial<T>` — and those members are the
  // author's however the mapping reached them.
  if (symbol.getName().startsWith('__')) return false;

  return symbol.getDeclarations().some((declaration) => {
    const file = declaration.getSourceFile();

    return file.isInNodeModules();
  });
}

/**
 * What a type is made of, each part paired with
 * the name to add to the dot-path.
 *
 * Only a property adds a name. An array element, a
 * tuple member and a union or intersection
 * constituent all belong to the member that holds
 * them, and there is no dot-path that would
 * address one of them separately.
 */
function partsOf(type: Type): [string, Type][] {
  if (type.isUnion()) return unnamed(type.getUnionTypes());
  if (type.isIntersection()) return unnamed(type.getIntersectionTypes());
  if (type.isTuple()) return unnamed(type.getTupleElements());

  const element = type.isArray() ? type.getArrayElementType() : undefined;
  if (element !== undefined) return unnamed([element]);

  return type.getProperties().flatMap((property): [string, Type][] => {
    if (isCompilerNamed(property)) return [];

    const declared = typeOfMember(property);

    return declared === undefined ? [] : [[property.getName(), declared]];
  });
}

/**
 * Whether the compiler, rather than the author,
 * chose this member's name.
 *
 * A member written under a computed key — a
 * well-known symbol, most often — is carried under
 * a name TypeScript invents, ending in a number it
 * hands out as it reads. No dot-path addresses that
 * name, and a scan that read a different set of
 * files reports the same member under a different
 * one, which would land in the manifest.
 *
 * A quoted key is not this. `'content-type'` is a
 * name the author wrote and a reader can find.
 */
function isCompilerNamed(member: TypeMember): boolean {
  return member.getName().startsWith('__@');
}

function unnamed(types: readonly Type[]): [string, Type][] {
  return types.map((type) => ['', type]);
}

/**
 * A member's type, read at its own declaration.
 *
 * A member with no declaration at all is one the
 * checker synthesised, and there is no source
 * position from which to ask what it is.
 */
function typeOfMember(member: TypeMember): Type | undefined {
  const declaration =
    member.getValueDeclaration() ?? member.getDeclarations().at(0);

  return declaration === undefined
    ? undefined
    : member.getTypeAtLocation(declaration);
}

function join(path: string, member: string): string {
  if (member === '') return path;

  return path === '' ? member : `${path}.${member}`;
}
