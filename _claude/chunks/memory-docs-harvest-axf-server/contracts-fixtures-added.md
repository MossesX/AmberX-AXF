<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md tokens=217 -->
## Contracts / fixtures added

- `framework/spec/fixtures/wall-signature.json` — 19 signature cases (valid, host case-folding, empty perms, 120 s edge,
  stale, future, wrong host, tampered perms/role/user, wrong secret, bad version/timestamp/length, upper-case hex,
  extra part, empty, secret < 32) + 10 header → caller cases. Replayed by `framework/spec/check-axf-server.mjs` (Node,
  reference signer = axHub's scheme) and `framework/python/axf_server/test.py`.
- `framework/spec/fixtures/plugin-package.json` — 42 package cases + 16 path cases generated from
  `framework/cli/plugin-catalog.mjs` itself (`--write`), replayed against the .mjs (so it can't drift) and the Python port
  (identical messages and content hash, incl. UTF-16 path ordering).
- Catalog: feature `f.pyserver` (Foundations → observability/security/build), status built, module `axf_server`.
