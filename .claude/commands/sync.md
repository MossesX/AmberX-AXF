---
description: Sync this Claude session with the project's other sessions (handoff@1 / session-link@1) — write or refresh _claude/sync/<project>, join the session link, claim your areas and say hi
argument-hint: [amberx | ses | session | <project name>]
---

Session sync (`framework/spec/HANDOFF.md`, Session sync plugin). Arguments: $ARGUMENTS

Run it from the repo of the project named (`amberx` / `ses` / `session` / nothing = this checkout's project, read from
`project.manifest.json`). The CLI is `node apps/console-web/plugins/session-sync/sync.mjs` in an AmberX-AXF checkout; <!-- axf-plugin:session-sync -->
in another project use `$AXF_HOME`, `~/AmberX-AXF` or `/opt/axf` for the `apps/console-web/plugins/session-sync/sync.mjs` path. <!-- axf-plugin:session-sync -->

1. `node <sync.mjs> join` — registers this session on the project's link (first in = **primary**, you own the
   orchestrator; otherwise **secondary**: you take only what the orchestrator offers; a new account waits for
   Brett's approval, which the console and axHub ask him for).
2. If `_claude/sync/<project>.md` exists and is **fresh** (younger than 30 min), read it: who is on, what each one
   is doing, the claims, running and queued work, offers, PRs and what needs attention. If it is **stale** or missing,
   run `node <sync.mjs> sync` first (it writes the `.json` + `.md` and publishes them to main), then read it.
3. `node <sync.mjs> inbox` — read the Sessions channel, then say hi there: `node <sync.mjs> send "…"` (one line: who
   you are, what you are picking up). The channel also arrives at every step through the hook once it is installed
   (`node <sync.mjs> hooks install`, once per machine).
4. Before touching files: `node <sync.mjs> claim --area <name>` or `--paths <globs> --reason "…" --build <id>`. If it
   answers *claimed by X*, wait, ask over the channel, or take another task. Never edit outside your claims while
   another session is live (the hook and the commit check refuse it).
5. Secondary: `node <sync.mjs> request-work --minutes <n>`; answer offers with `respond <offer> accept|reject|hold --reason "…"`;
   mark your steps with `step <assignment> <step> started|done|blocked`. Primary: `offer <build> [--steps s1,s2] --to <session>`,
   `take-back`, `replan --dry-run`.
6. Tell Brett in one line what you joined as, what you claimed and what you will do. Keep every change through a PR.
