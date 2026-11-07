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

## Addendum 1 (Brett, Nov 4 2026 (voice))
> A later change he asked for, verbatim. Each one is its own block, numbered, oldest first. Also:
> node framework/cli/build-origin.mjs addendum <build-id> --said "…" --source voice

## UI Review (when the build changes UI)

Ship at least 3 options (the setting may ask for more), each a predicted look and an asset of its type:
`review.mjs submit --choices <file.json> --console`. With the ask setting on, run `review.mjs ask-options --build <id>
--wait --console` first and make that many. Every option is written to `plugins/<owner>/assets/<type>/` and ships in
the PR, picked or not. Wait for Brett's pick (`review.mjs decision <id> --console`), then build every view he picked,
the first as the default. One option only with a real reason: `--single-option "<why>"`.

