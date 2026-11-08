<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md tokens=677 -->
## Recording

```bash
C=apps/console-web/plugins/codebase-changes/changes.mjs  <!-- axf-plugin:codebase-changes -->
node $C hooks install                         # once per machine: Claude Code hooks in ~/.claude/settings.json (.bak kept)
node $C open "Title" --kind build --step "first step" --step "second step"   # by hand (the hook does this itself)
node $C step last "first step" --state running            # then --state done | failed | skipped [--note "…"]
node $C result last --state done --summary "what changed" --branch feat/x --commit abc1234 --files 12 \
       --test "test.py=0→105" --link report=_claude/memory/docs/x.md
node $C close last | reopen last | show last | list [--open] | where | flush
```

Where a run writes (first that works): `AXF_CHANGES_DIR` → the shared data folder (hub) → the console API with
`AXF_TOKEN` (`AXF_CONSOLE_URL`, default https://console.amberxai.com; https only, no redirects, token only in the header)
→ `--to-repo` (this clone's `changes/`, commit it) → a local queue `~/.axf-changes/queue` (0700), sent on by the next run
that can reach one of the others (`flush`). `last` = the entry most recently opened on this machine.

**The hook** (`UserPromptSubmit`, `Stop`, `SessionEnd`; always exits 0, never blocks):

- `UserPromptSubmit`: a prompt that asks for a change opens an entry (title = its first sentence, request cut to 600
  characters with secrets hidden, repo from `git remote`, where = vps/cloud/local) and prints the entry id and the exact
  `step` / `result` commands into Claude's context. Same session + same prompt = same id, so nothing doubles.
- Classifier (simple on purpose, `classify()` in `changes-core.mjs`): slash commands and empty prompts are skipped; a prompt
  that opens like a question (what/why/how/where/when/who/which/is/are/does/explain/tell me/show me/list…) is a question
  unless it also says please / go ahead / can, could, would, will you; otherwise the **first** change word decides the
  kind — remove (remove, delete, uninstall, drop, get rid of, rip out, take out), fix (fix, repair, debug, resolve, patch,
  broken), build (build, create, add, implement, make, write, scaffold, set up, install, port, generate), edit (edit,
  change, update, modify, rename, refactor, move, replace, rework, tweak, adjust, improve, convert, migrate, rebuild).
- `Stop` (end of a turn): steps still `running` become `done` (note "auto: the turn ended"); the result stays open.
- `SessionEnd`: queued steps become `skipped`, and an entry with no result gets `partial` ("The session ended before a result was recorded.").
- The rule in `_claude/rules/RULES.md` ("Codebase changes log") tells every session to record steps and results.
