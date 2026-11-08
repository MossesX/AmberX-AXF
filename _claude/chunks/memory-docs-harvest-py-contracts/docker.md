<!-- memory-chunk@1 source=_claude/memory/docs/harvest/py-contracts.md tokens=129 -->
## Docker

`apps/console-web/server/Dockerfile`: one line changed — `ENV … PYTHONPATH=/axf/framework/python` added to the
existing `ENV AXF_CONSOLE_DIST=…` line, plus a 3-line comment above it. `framework/python` was already in the image
(`COPY --from=web /axf /axf`, repo-root context) and in the host clone mounted over `/axf`; the plugins also add the
path themselves, so the env var is belt and braces for `axf_server/` (another group adds that package; nothing else
in the Dockerfile touched, no `COPY` added).
