<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=92-104 tokens=259 -->
## Docs / CI

- `framework/spec/ASSISTANT.md`: Build Pilot host → **built** (own engine on the baked contract, routes `/api/assistant/*`).
- `framework/spec/check-addons.mts`: every `*.addon.json` and `addons/<id>/addon.json` in the repo passes
  `validateAddon` + `validateAgentItem` (shape), no duplicate ids, risks printed. Today: the agent manager's 3 bundled
  add-ons pass; Build Pilot's `pilot-assembler.addon.json` 2.1.0 also passes when copied in.
- android.yml engine job: `setup-python`; `bash -n` for `framework/deploy/*.sh`, the console installer and the
  template installer; `shellcheck -x framework/deploy/*.sh` (`shellcheck-py==0.10.0.1`); `bash framework/deploy/test.sh`;
  the add-on check; the template sweep now inits `web-fastapi-wall`, builds it, runs its server self-test and
  `bash -n` + shellcheck on its installer.
- Docs: `framework/deploy/README.md`, template README, root README + `_claude/memory/docs/axf-architecture.md`
  (defaults/starter lines, templates, deploy folder), CLAUDE.md Status + layout.
