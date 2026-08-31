/**
 * `mboss.config.ts`, which holds one key today.
 *
 * It is committed from the start so that the next
 * setting has somewhere to go that is already
 * under review, rather than arriving as a new file
 * in the same change that needs it.
 */
export function mbossConfig(name: string): string {
  return `// This project's settings. One key today; the
// file exists so the next one has a home that is
// already committed.
export default { name: '${name}' } as const;
`;
}
