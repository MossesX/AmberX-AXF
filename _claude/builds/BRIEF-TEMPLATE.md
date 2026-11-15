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

Needs MCP: none
Needs tools: none
<!-- Optional. Headless runs start with NO MCP servers and only the built-in tools Bash, Read, Edit, Write, Glob, Grep
     (brief only, headless-context@1). Name what this job truly needs, comma-separated: MCP servers (known: axhub),
     extra tools (e.g. WebFetch, NotebookEdit, TodoWrite). Claude settings → Headless sessions sets both for every run. -->

## Rules for this job
<!-- Brief only (Nov 8 2026): a headless run loads NO CLAUDE.md, rules files, memory or settings-injected context. This
     block is all the standing rules it gets. `orchestrator.mjs brief <id>` writes it in for you (the rules brief from
     Claude settings → Rules briefs, plus every rule bullet whose tag, e.g. ui-review, the brief names). Leave the
     heading out and the launcher appends the same block at launch. Size budget: Claude settings
     headless.briefBudgetChars (default 24000 characters ≈ 6K tokens, brief and rules together); over it, the run still
     starts, with a warning in its log and a note on the build. Keep only what this job needs. -->

## Addendum 1 (Brett, Nov 4 2026 (voice))
> A later change he asked for, verbatim. Each one is its own block, numbered, oldest first. Also:
> node framework/cli/build-origin.mjs addendum <build-id> --said "…" --source voice
