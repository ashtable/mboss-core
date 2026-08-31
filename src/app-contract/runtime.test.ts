import { describe, expect, it } from 'vitest';

import { APP_DIR } from './layout.js';
import { RUNTIME } from './runtime.js';

const MODULES = Object.entries(RUNTIME);

describe('the runtime table', () => {
  it('names every module the generated code reaches for', () => {
    expect(Object.keys(RUNTIME)).toEqual([
      'contract',
      'db',
      'mail',
      'mailer',
      'waits',
    ]);
  });

  it.each(MODULES)('%s is imported from the app directory', (_name, entry) => {
    expect(entry.specifier.startsWith('../app/')).toBe(true);
  });

  it.each(MODULES)('%s is imported with a .js extension', (_name, entry) => {
    expect(entry.specifier.endsWith('.js')).toBe(true);
  });

  it.each(MODULES)('%s names at least one export', (_name, entry) => {
    expect(entry.exports.length).toBeGreaterThan(0);
  });

  it.each(MODULES)('%s lists its exports in sorted order', (_name, entry) => {
    expect([...entry.exports]).toEqual([...entry.exports].sort());
  });

  it('reaches only the app directory, never the workflows one', () => {
    for (const [, entry] of MODULES) {
      // `../app/` from `src/workflows/x.ts` is
      // `src/app/`, which is the only tree a
      // generated workflow is allowed to import.
      expect(entry.specifier.replace('../app/', `${APP_DIR}/`)).toContain(
        APP_DIR,
      );
    }
  });

  it('names the contract file only once, as a type-only module', () => {
    expect(RUNTIME.contract.specifier).toBe('../app/contract.js');
    expect(RUNTIME.contract.exports).toContain('WorkflowEntry');
  });
});
