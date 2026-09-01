/**
 * The project's TypeScript settings.
 *
 * The `compilerOptions` block is mBoss's own,
 * value for value — a test compares the two — so
 * generated code is checked here under exactly the
 * settings it was checked under before it shipped.
 *
 * `erasableSyntaxOnly` earns its place: the app
 * runs under tsx, which strips types with esbuild
 * rather than compiling them. Anything type
 * stripping cannot erase — an enum, a parameter
 * property, a namespace — has to fail at the
 * type-check rather than at container start.
 * Neither the compiler nor the runtime emits any
 * of those, and this is what keeps it that way.
 *
 * `src/workflows` is included even though eslint
 * and prettier both skip it. Compiler-owned code
 * is exactly the code nobody reads, so it is the
 * code that most needs type-checking.
 *
 * Written out as text rather than built from an
 * object: Prettier keeps a short array on one line
 * and `JSON.stringify` always breaks it, and the
 * emitted file has to satisfy the project's own
 * `prettier --check`.
 */
export const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "src",
    "lib",
    "prisma.config.ts",
    "mboss.config.ts",
    "vitest.config.ts"
  ]
}
`;
