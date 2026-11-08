# Build: <build-id> (<Profile> profile)

## Brett said (verbatim)
Source: voice · At: 2026-11-03T14:05:00Z · Session: <session or conversation id> · Link: <url>
> Brett's exact words, as transcribed. Unedited: no fixes, no summary, no tidying.
> Several lines are fine.

<!-- Required. The launcher (deploy/claude-headless.sh → framework/cli/build-origin.mjs capture) records this block on
     the build as origin.said (build-origin@1), and every view of the build shows it first as "What Brett said".
     The meta line is optional: Source = voice | chat | console | code. Your own reading of what he wants goes in
     the sections below, never in this block. -->

## What to build
Your paraphrase, the plan, the steps (s1 …), checks.
Every brief also carries the API rule (Brett, Nov 8 2026: "everything comes with an API"): anything with a UI gets a
deep link, readable state and every action and setting through REST, MCP, the CLI and voice. The orchestrator adds it
(`API_RULE` in `apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs`). The build's stepped plan
appears in Plan Studio by itself and stays in sync both ways (build-mirror@1).

## Addendum 1 (Brett, Nov 4 2026 (voice))
> A later change he asked for, verbatim. Each one is its own block, numbered, oldest first. Also:
> node framework/cli/build-origin.mjs addendum <build-id> --said "…" --source voice
