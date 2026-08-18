import { describe, expect, it } from 'vitest';

import { listUnsubscribeHeaders } from './list-unsubscribe.js';

describe('listUnsubscribeHeaders', () => {
  it('spells out both RFC 8058 headers', () => {
    expect(
      listUnsubscribeHeaders('https://mboss.dev/api/unsubscribe/tok-1'),
    ).toEqual({
      'List-Unsubscribe':
        '<https://mboss.dev/api/unsubscribe/tok-1>, ' +
        '<mailto:unsubscribe@mboss.dev>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});
