<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md lines=1-5 tokens=65 -->
# Harvest — axf-server (Oct 20 2026, Opus 5.5)

Branch `harvest/h-axf-server`. Brett's decision: shared Python server helpers go in a new package
`framework/python/axf_server/` (not `axf_libs`). Stdlib only, typed (`mypy --strict` and pyright clean), tested.
