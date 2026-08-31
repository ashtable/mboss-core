# mboss-core

mBoss: Design Durable Apps with DBOS - Shared Core Library

## signed-links

`src/signed-links/` mints and verifies the compact HMAC-SHA256 bearer tokens behind every
`mboss.dev/u/<token>`, `/f/<token>` and `/a/<token>` URL. It imports nothing but `node:crypto`, and
a test enforces that: cloud consumers alias `@mboss/core/signed-links` directly rather than the
package barrel, so their type-check never has to resolve the rest of this library.

Key ring: `LINK_KEYS="k1:<64-hex>,k0:<64-hex>"` — comma-separated `kid:key` pairs, the first of
which signs and all of which verify. Rotate by prepending a new pair, then drop the old one once
the deprecation window has passed.

Mint **inside a durable step, never in a workflow function body** — `iat` and `exp` come from the
clock, so minting during replay would produce a different token than the original run.

## email

`src/email/` renders both mBoss emails — the waitlist confirmation and the admin broadcast — from
the shell card down to the small Markdown dialect a broadcast body is written in. The worker sends
these messages and the admin console previews them live as they are composed, so there is one
implementation here rather than two that drift. Sending itself stays in the worker: it needs a
provider key and a network.

It imports **nothing at all**, not even a `node:` builtin, and a test enforces that. The preview
runs in a browser, where a builtin would break the bundle. Alias `@mboss/core/email` directly:
`email` is the one shipped module deliberately kept out of the package barrel, and the cloud
consumers are barred from importing the barrel at all by an ESLint rule in each repo, so they
reach every module they use through its own subpath.

The four `.html` file snapshots beside the tests are the whole rendered cards, kept as files so an
email can be opened and looked at — the only way to review one.
