<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md tokens=624 -->
## Changed
- **Models (s1, s2):** `requiredTier(step)` = the step's orchestrator pin (any spelling, through `modelKey` + `coerceModel`),
  else the policy's own `modelForWork` (foundation words → Fable, the rest → Opus). Before: a Fable pin only counted when the
  step text also matched a private regex, and a text about "engines" forced Opus even when pinned to Fable. A raw record
  naming Sonnet or Haiku is refused by name by the validators (stored ones still load, coerced up).
- **Planner (s2):** a step no skill matches goes to the roster's `fallback` agent when it names one, else the most
  capable agent (largest token budget), never the cheapest by accident (before: the $5 docs agent took every unmatched
  step). `leasesOverlap` also catches a folder lease against a glob rooted inside it (`apps/console-web/` vs `apps/*/src/`).
  One agent works one job at a time across builds (before: only within one build). Every job is shaped by `normJob`.
- **Context packer (s3):** `extractSnippet` scores each hit line (one per distinct task word, +1 for a definition line;
  task words on more than a quarter of the file's lines are ignored) and keeps the best within the 120-line cap, printed
  in file order (before: first hits in file order, so the right function at the end of a long file was cut off).
  Area-leased jobs now get an outline of each leased folder (own files, subfolders with counts, 60 lines shared across
  folders) and the prefix lets them read inside their leased folders (before: an area job got no context at all and was
  told not to explore). Measured on this build's own s3 job: prompt 4 321 → 352 tokens; the shared prefix is 442 tokens,
  skills 120–225.
- **Avatar (s4):** drawn from `avatarModel(agent.avatar)` in the card rules: a part list (bg, shirt, face, hair, eyes,
  mouth, gear) with role paints and the two theme tokens the hue picks. The React `Avatar` only renders the list.
  `AGENT_CARD_SAMPLE` carries an `avatar` and its favourite model is Opus (was Sonnet).
- **Chat (s5):** every Boss line and crew line is a builder in `swarm-chat.mjs`; `messageErrors` enforces who may post
  which kind and that a job line names its job. Found and fixed: Boss's "clean up this clash" line is a `handoff`, which
  the speaker table did not allow Boss until the fixture caught it.
- **Vibe (s6):** the word lists are a registry (`VIBE_WORDS`, `VIBE_WEIGHTS`, `VIBE_LEVELS`) and `post` takes the filter
  as a hook, so a port can replay the same fixture.
