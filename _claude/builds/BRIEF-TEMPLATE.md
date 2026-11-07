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

## Glossary and catalog (every build)

The Glossary, Index & Demos plugin rebuilds its catalog by itself on every build event (build-hook@1). Your part: describe what you add where it is defined (plugin.json `description`, each command's `description`, asset `description`, a CLI header comment), then `node apps/console-web/plugins/glossary-index/catalog.mjs --check` must pass (a new undescribed item fails CI). A UI you add can ship a demonstration (demonstration@1): `node apps/console-web/plugins/glossary-index/demos.mjs generate <entry id> --save`. <!-- axf-plugin:glossary-index -->
