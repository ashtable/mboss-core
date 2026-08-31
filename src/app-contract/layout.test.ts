import { describe, expect, it } from 'vitest';

import {
  APP_DIR,
  CONTRACT_FILE,
  LIB_DIR,
  REGISTRY_FILE,
  WORKFLOWS_DIR,
  libSpecifier,
  registrySpecifier,
  workflowFileName,
  workflowFilePath,
} from './layout.js';

describe('the directory constants', () => {
  it('are project-relative posix paths', () => {
    expect(LIB_DIR).toBe('lib');
    expect(APP_DIR).toBe('src/app');
    expect(WORKFLOWS_DIR).toBe('src/workflows');
    expect(CONTRACT_FILE).toBe('src/app/contract.ts');
    expect(REGISTRY_FILE).toBe('src/workflows/index.ts');
  });

  it('put the contract and the registry in their directories', () => {
    expect(CONTRACT_FILE.startsWith(`${APP_DIR}/`)).toBe(true);
    expect(REGISTRY_FILE.startsWith(`${WORKFLOWS_DIR}/`)).toBe(true);
  });
});

describe('workflowFileName', () => {
  it('is the workflow name plus the generated suffix', () => {
    expect(workflowFileName('groom_booking')).toBe('groom_booking.workflow.ts');
  });

  it('refuses a name that would name a path outside the directory', () => {
    expect(() => workflowFileName('../escape')).toThrow();
  });
});

describe('workflowFilePath', () => {
  it('is under the workflows directory', () => {
    expect(workflowFilePath('groom_booking')).toBe(
      'src/workflows/groom_booking.workflow.ts',
    );
  });
});

describe('libSpecifier', () => {
  it('reaches lib from a generated workflow, with a .js extension', () => {
    expect(libSpecifier('lib/types.ts')).toBe('../../lib/types.js');
  });

  it('keeps a nested path', () => {
    expect(libSpecifier('lib/sub/x.ts')).toBe('../../lib/sub/x.js');
  });

  it('normalises a windows-style path to posix', () => {
    expect(libSpecifier('lib\\sub\\x.ts')).toBe('../../lib/sub/x.js');
  });

  it('leaves a path that already ends .js alone', () => {
    expect(libSpecifier('lib/types.js')).toBe('../../lib/types.js');
  });
});

describe('registrySpecifier', () => {
  it('is a sibling import of the generated workflow', () => {
    expect(registrySpecifier('groom_booking')).toBe(
      './groom_booking.workflow.js',
    );
  });

  it('ends in .js, which is what node will resolve', () => {
    expect(registrySpecifier('groom_booking').endsWith('.js')).toBe(true);
  });
});
