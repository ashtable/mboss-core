/**
 * Node's filesystem errors carry a `code`, but a
 * `catch` hands them over as `unknown`. Every
 * place in this module that means "the file was
 * not there" rather than "the disk is broken"
 * asks through here, so none of them has to
 * widen a type by hand.
 */
export function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
