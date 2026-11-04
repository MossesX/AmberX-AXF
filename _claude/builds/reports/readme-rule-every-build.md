# readme-rule-every-build: every build ships a basic Markdown readme

Brett, Nov 4 2026 (voice): "We gotta structure the documentation engine later anyway, so leave that out. Just get basic
documentation. In Markdown." Asked whether every future build should include a basic Markdown readme: "Yeah."

Model Opus · agent Kotlin Kat (session default) · branch `claude/readme-rule-every-build`.

## What changed
- **Rule:** `_claude/rules/RULES.md` and `CLAUDE.md`: every build ships, in the same PR, a plain Markdown
  `docs/README.md` inside the plugin / app / module folder it adds or changes (or a section in an existing one): what it
  does, how to use it (screens, settings, right-click actions, voice commands), commands (API / MCP / CLI),
  troubleshooting. No docs engine.
- **Briefs:** `DOCS_RULE` in the orchestrator brief (`build-orchestrator/web/orchestrator-core.mjs`) and the Build
  manager brief (`build-manager/web/orchestrate.mjs`), `DOCS_NOTE` appended by `deploy/claude-headless.sh` to every
  headless prompt (so build_start and console launches get it), and a *Docs (every build)* section in
  `_claude/builds/BRIEF-TEMPLATE.md`.
- **CI:** `framework/cli/check-docs-readme.mjs` (+ `--self-test`), a step in the engine sweep of `android.yml`
  (checkout now `fetch-depth: 2`). It fails when the change adds a new folder under `apps/`, `apps/*/plugins/`,
  `framework/libs/` or `framework/android/` without `docs/README.md`. Folders that exist on the base are grandfathered.
  Base = `HEAD^1` in Actions (the PR merge commit's first parent), else the merge base with `origin/main`; no base
  reachable = skipped with a note.

## Tests
- build-orchestrator test.mjs 30 → 31 (brief carries the readme rule); build-manager test.mjs +1 check, all 129 pass.
- check-docs-readme self-test 7/7; simulated new plugin folder without a readme fails, the clean tree passes.
- check-agent-slots (runs claude-headless.sh end to end) 56/56, check-build-origin 21, check-model-policy 16.

## Not done (on purpose)
- No documentation engine (planned separately).
- Grandfathered folders aren't checked for a readme section when a build changes them; that half is a brief rule only.
