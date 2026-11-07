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

Every UI it adds is controllable by the API (rule "The API controls everything", Nov 7 2026): each control has an
accessible name, each action is registered, each setting is declared, each server route is a plugin command, and
anything only Brett may tap carries `data-axf-person-only`. Check: `node framework/cli/api-coverage.mjs check`
(then `api-coverage.mjs write` and commit `apps/console-web/api-coverage.json`).

## Addendum 1 (Brett, Nov 4 2026 (voice))
> A later change he asked for, verbatim. Each one is its own block, numbered, oldest first. Also:
> node framework/cli/build-origin.mjs addendum <build-id> --said "…" --source voice
