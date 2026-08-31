import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Running a request handler on a real socket for
 * the length of one test.
 *
 * The route tests could call their handlers
 * directly with a fake request and response, and
 * would then be testing their own idea of what
 * Express does. Routing, method matching, status
 * codes, headers and body parsing are most of what
 * a route *is*, so these go over a real connection
 * on an ephemeral port.
 *
 * It takes a plain request listener rather than an
 * Express application, which is all an Express
 * application is, and keeps this module free of
 * anything the generated runtime depends on.
 *
 * This module is imported only by tests, but it is
 * not a `*.test.ts` — vitest would then try to run
 * it as a suite with no tests in it.
 */
export async function withServer<T>(
  handler: RequestListener,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Port zero: the operating system picks a free
    // one, so tests never collide with each other
    // or with anything already running.
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;

  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
