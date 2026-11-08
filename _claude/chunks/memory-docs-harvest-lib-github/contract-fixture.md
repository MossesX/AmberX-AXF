<!-- memory-chunk@1 source=_claude/memory/docs/harvest/lib-github.md lines=28-41 tokens=267 -->
## Contract / fixture

`framework/spec/fixtures/github.json` (hand-picked golden cases): `validRepo` 26, `parseRepo` 16, `repoPath` 13,
`apiPath` 4, `nextLink` 10, `runState` 17, `tokenAllowed` 14, `redirectStep` 11, `gitAuthConfig` 7, `gitEnv` 5,
`scrub` 6. Replayed by `framework/spec/check-github.mjs` (Node, + client guards against a fake fetch) and
`framework/python/axf_server/test.py` section 6 (+ client guards against a fake transport + real `git config` checks).
CI: engine job and console job (`.github/workflows/android.yml`). Change both ports and the fixture together.

Catalog: `w.github` → partial (module `axf_server.github`); plan `x.lib.github` → partial (python built, Node twin noted,
Android planned). Build-queue step `x.lib.github` stays open (Android port + demo app). **Not added to
`libraries.json`**: that index lists *app-installable* libraries — `axf install github` would add a Gradle dependency on a
module that doesn't exist, and Build Pilot / the console wizards would offer it for apps. It gets an entry when the
Android port exists.
