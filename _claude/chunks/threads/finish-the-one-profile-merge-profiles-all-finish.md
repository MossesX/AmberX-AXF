<!-- memory-chunk@1 source=_claude/THREADS.md lines=57-57 tokens=159 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Finish the one-profile merge (`profiles-all-finish`, All, Opus; Brett approved: fold main-framework into all, delete the old profile folders everywhere): `all` is the one base profile, old folders gone from repo + hub, publisher/resolver/merge-all keep them gone, `postgres-console` added | built (committed, not pushed) | `claude/profiles-all-finish` | – | land through the merge queue (after `merge-profiles-one`); then `node framework/cli/profiles.mjs merge-all` once to prune the hub's `framework/plan/profiles/all/`; Fable review of s1 | 2026-11-07 |
