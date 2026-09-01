/**
 * What an emitter throws when the document is a
 * legal draft that this compiler cannot turn into
 * code.
 *
 * An exception rather than a result type on every
 * emitter, and it is the one place in this
 * directory that uses one. Emission is a tree walk
 * a dozen functions deep, and threading a failure
 * back up through all of them would put an
 * error-handling branch in every emitter for a
 * case none of them can do anything about. It is
 * caught once, at `compileWorkflow`, and turned
 * into the `UNSUPPORTED` result the API promises.
 *
 * Only this class is caught there. A `TypeError`
 * out of the compiler is a bug in the compiler,
 * and reporting it to somebody as "your workflow
 * is unsupported" would send them looking in the
 * wrong place.
 */
export class UnsupportedIR extends Error {
  /** The block a person should look at, if it is
   *  about one block rather than the document. */
  readonly nodeId: string | undefined;

  constructor(message: string, nodeId?: string) {
    super(message);
    this.name = 'UnsupportedIR';
    this.nodeId = nodeId;
  }
}
