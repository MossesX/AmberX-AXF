# Remove the "no new Android or Kotlin work" rule; build Android twins in parallel

Brett: "just get rid of that rule, period. Get rid of it... right away. It's parallel."

## What changed
- Headless rules brief seed (`framework/schemas/rules-briefs.json`, core brief, Cross-port line): "No new Android or Kotlin work: record the twin as a deferred gap" → "Build the Android/Kotlin twin in parallel with the web side (same contract, same fixture); clear its PORTING.md deferred-gap entry when it lands." No live document exists at `/projects/_shared/_data/claude/rules-briefs.json`, so the seed is what every headless launch gets.
- `_claude/rules/RULES.md`: the "All Android work is on hold" rule is replaced by "Android/Kotlin twins are built in parallel"; the engine-compatibility rule's pointer updated.
- `_claude/shared/rules/RULES.md`: "frozen (Android on hold…)" → "frozen (older Android code…)" (the conformance baseline still applies to old Kotlin code).
- `_claude/memory/decisions.md`: the Oct 21 hold entry is marked lifted (Nov 13 2026).
- Brief templates: claude-handoff session rules (`handoff-core.mjs`) and the agent-swarm skills/notes (kotlin-compose, ci-fix, listener-qa, earl) no longer tell agents Android is on hold.
- `framework/spec/PORTING.md`: Port status note: the hold is lifted, existing deferred entries are a backlog to clear, no new deferred entries for twins.

## Not changed
- `CLAUDE.md` never carried the rule (only a factual line on the frozen-code baseline).
- Code comments that say a specific twin is "deferred (Android on hold)" describe the current state of that code; they stay until the twin is built.
- `_claude/handoff/context/*` are generated snapshots; they refresh on the next handoff.

## Tests
`node framework/spec/check-rules-android.mjs` (wired into `.github/workflows/android.yml`): the seed, both RULES.md files and every plugin `.md/.mjs/.py` carry none of the hold phrases; the composed headless rules brief has no hold and says to build the twin in parallel. 551 checks pass. `claude-handoff/test.mjs` 95 pass; `plugin-lifecycle check agent-swarm` clean.

## API
No UI. The rules brief stays reachable as before: `node framework/cli/rules-brief.mjs get core` / `preview`, Claude settings → Rules briefs.
