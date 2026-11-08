<!-- memory-chunk@1 source=_claude/memory/docs/build-steps.md tokens=74 -->
# Build steps — small steps for big builds (Oct 21 2026, Fable)

Rule (`_claude/rules/RULES.md`): every build estimated at more than 30 minutes is split into steps of 30 minutes or
less, each with its own estimate, so it can be worked on little by little. Builds of 30 minutes or less stay whole.
