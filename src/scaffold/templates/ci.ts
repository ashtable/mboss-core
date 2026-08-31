/**
 * The project's own CI.
 *
 * Generated code is committed on purpose — it is
 * reviewable in a pull request — and committed
 * generated code with no CI checks nothing.
 */
export const CI_YML = `# Generated code is committed, so CI reads it like
# any other source. A check that regeneration
# produces no diff belongs in this job too; it
# needs a command-line entry point that does not
# exist yet, and joins here when that lands.
name: CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test
`;
