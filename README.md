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
