import { describe, expect, it } from 'vitest';

import { requireSecret } from './ports.js';

/**
 * `requireSecret` is the one gate every
 * workflow-starting route shares, so it has to
 * fail closed on its own, not by trusting that
 * whatever configured it already checked.
 */
describe('requireSecret', () => {
  it('refuses to guard anything with an empty secret', () => {
    // An empty header and an empty expected secret
    // compare equal, so a guard built from '' would
    // authorize every request that sends no header
    // at all. Refusing at construction turns that
    // into a boot failure instead of an open route.
    expect(() => requireSecret('')).toThrow();
  });
});
