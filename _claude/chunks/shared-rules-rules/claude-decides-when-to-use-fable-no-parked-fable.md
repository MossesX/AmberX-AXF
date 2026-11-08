<!-- memory-chunk@1 source=_claude/shared/rules/RULES.md tokens=154 -->
## Before building anything

- **Claude decides when to use Fable; no parked Fable rebuilds (Oct 27 2026, Brett; replaces "Fable suggested, Opus chosen = park a Fable rebuild"):** "No Fable rebuilds should be in Refactor yet. All Fable stuff will be done by Fable. From now on you decide when to use Fable." Claude picks Fable or Opus for each step itself (the model rule in the Build orchestrator), without asking Brett for a model. Don't park "Fable rebuild" items for work built on Opus: work that needs Fable is built on Fable in the first place. Existing Fable rebuild items stay out of the Refactor profile.
