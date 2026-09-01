import { describe, expect, it } from 'vitest';

import { withServer } from './serve.js';

/**
 * The harness the route tests stand on. If it
 * quietly served nothing, or held the port open
 * afterwards, every one of those tests would still
 * look green.
 */

describe('withServer', () => {
  it('serves the handler it was given, on a real socket', async () => {
    const body = await withServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('served');
      },
      async (base) => (await fetch(`${base}/anything`)).text(),
    );

    expect(body).toBe('served');
  });

  it('gives back what the test returned', async () => {
    const value = await withServer(
      (_request, response) => response.end(),
      async () => 42,
    );

    expect(value).toBe(42);
  });

  it('closes the port afterwards, even when the test threw', async () => {
    let base = '';

    await expect(
      withServer(
        (_request, response) => response.end(),
        async (url) => {
          base = url;
          throw new Error('the test failed');
        },
      ),
    ).rejects.toThrow('the test failed');

    await expect(fetch(base)).rejects.toThrow();
  });
});
