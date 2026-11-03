# land-everything (Urgent, Opus) — Nov 3 2026

Brett (voice): "Fuck the review, I review it. Just go. Get everything live." UI Review waived except banners.
Each branch: origin/main merged in its worktree, data conflicts resolved by the rules in the brief (builds store per
record newer-wins via the builds-live merge driver, exports regenerated, journals unioned, logs union-merged, hub copies
newer-wins), baked framework copies re-baked from the merged framework (`rebake.mjs apply --force` + `shared-assets.mjs
bake`), the local CI block run and compared with a main baseline, then the branch fast-forwarded onto main (never forced).

Local CI block per branch: `axf validate --framework`, tracker / plugins / project checks, every `framework/spec/check-*.mjs`
in the workflow, `builds-store verify`, `help-coverage --check`, `check-theme`, `check-controls`, `check-plugin-pages`,
plugin lifecycle for every lifecycle plugin, every `plugins/*/test.mjs` + `test.py`, and `npm run build` (tsc + vite) of
the affected apps after a re-bake. Branches touching the console server also ran the workflow's Python API + MCP smoke and
`test_mcp_tools.py` in the `axf-console` image. Host Node is 20 (workflow is 22), so a handful of checks fail on main too
(hub-data tracker/plugins checks, synced `apps/*/_claude/shared` copies in lifecycle scans, `--experimental-strip-types`);
a branch landed only when it added no failure over that baseline.

## Landed (AmberX-AXF main)

| Order | Branch | PR | Landed at | Fixes made while landing |
|---|---|---|---|---|
| 1 | claude/notes-vault | #256 | 5a6311a3 | notes-browser page head (eyebrow + one-line description); THREADS line made a managed mention; untracked the builds-live cache file |
| 2 | claude/agent-chats-hub | #248 | c985c38d | — |
| 3 | claude/kill-patches-pilot | #258 | e697c302 | tracker.json `generatedAt` conflict (generated file) |
| 4 | claude/headless-tabs | #259 | a8186b83 | PORTING.md headless-tabs line made a managed mention of console-terminal |
| 5 | claude/whats-new-banner | #260 | 6ff111a1 | plugins README conflict (kept the whats-shipped line + main's embed/push-banner lines) |
| 6 | claude/molly-fable + claude/xlayout-opus | #245, #252 | bffc2601 | re-bake (lockfile conflicts) |
| 7 | claude/token-control + token-control-opus + console-commands | #246, #250, #249 | 0a85ab65 | re-bake; PORTING union; px breakpoints in notes-browser, whats-shipped, Molly xlayout + toolbar designer moved to viewport attributes (token-control's layout rule); lifecycle: tests/fixtures name sample plugins, `*.gen.mjs` bundles treated as data, THREADS token-control line managed |
| 8 | claude/theme-editor | #243 | 6f20dd54 | px breakpoint → `data-fx-medium` |
| 8 | claude/model-upgrade-approval | #253 | 03d1d75f | real conflicts with orch-live-sync in the orchestrator (kept the upgrade check and `mergedAt`; docstrings + health probe both kept), mcp_server (upgrade tool + control/console tools both kept), CLAUDE.md; help for the two approve-upgrade buttons; THREADS agent-swarm line managed |
| 8 | claude/one-look-default-2 | #244 | 4ff2cc50 | re-bake; PORTING duplicate line |
| 9 | claude/theme-veto-pass (= claude/pass-all) | #262, #264 | 16620d72 | real conflicts with console-commands across control@1: domains `console` + `pass`, `pass.scopes` after the console targets, server route runs off the event loop with the owner approval, MCP target list, docs/help unioned, CONTROL.md, fixtures regenerated (333 control checks) |
| 9 | claude/plugin-commands-auto | #263 | cdd568c2 | same with the pass target: `plugins.*` after `pass.scopes` (append-only), 22 targets / 19 permissions, fixtures regenerated (360 checks); `commands` block added to notes-browser, theme-editor, whats-shipped |
| 9 | claude/axhub-veto-pass-web | #261 | bc344492 | AXHub web help for the Passes screen (9 controls) |

All PRs above show merged on GitHub (#262 needed the merge API call; it added an empty merge commit 08729f18).

Incident, fixed: the console-commands landing emptied `framework/spec/PORTING.md` on main (a union merge read process
substitution, which `git merge-file` can't). Restored at 0b9b24c4 as the union of both sides; no other file was emptied
(checked every file changed since afb3c7a9).

## axHub (MossesX/axHub main)

| Branch | PR | Landed at | Tests |
|---|---|---|---|
| claude/kill-patches-pilot | #32 | d3cf462 | 517/517 (node:22) |
| claude/axhub-veto-pass (= claude/axhub-pass-all) | #33, #34 | 6334d34 | 557/558 under load; the one (passes.test.ts, timeout) passes alone (7/7) |

axHub's Coolify app does not deploy on push; the deploy was queued through Coolify's own queue
(`queue_application_deployment`) and finished: container `jghxpzuudkahgznvffiwtwmj` on image 6334d34, healthy, `/healthz` 200.

## Not landed (on purpose)

claude/banner-pack (#251), claude/banner-editor (#254), claude/banners-one: Brett reviews banners himself. Untouched.

## Deploys

- Console (`/opt/axf`), AmberX web, AXHub web, Molly: their 5-minute update scripts rebuilt from main (last at 3bf838fb,
  then the console again at 42c9a756). Containers up; behind the wall each answers 200 (`console /api/health` ok,
  54 plugins, none with a load error, the new ones loaded: notes-browser, whats-shipped, theme-editor, token-control,
  console-commands, plugin-commands).
- Status-only commits don't redeploy: they touch only `_claude/`, carry `[skip ci]` (GitHub skips deploy.yml and
  android.yml), and every installed update script exits early when only `_claude/` changed. No workflow change needed.

## Services registered on axHub

- `axf-console` (mcp, `https://console.amberxai.com/mcp`, credential `axf-console-token` from the console's AXF_TOKEN),
  preset `recommended` (reads allow, writes veto, destructive tools approval). The same endpoint carries token control
  (`control_*`, `pass_*`), console commands (`console_*`) and plugin commands, so it is one service. Live tools/list
  checked with the console token.

## Left for Brett / follow-ups

- kill-patches-pilot s7: removing the Patches/Pilot `/projects` trees on the hub is a delete; left for his call.
- Checklist One: nothing ticked (UI Review item still covers the banner PRs he keeps; voice test can start now that the
  console MCP is live on axHub).
- `node apps/console-web/plugins/build-orchestrator/test.mjs` (not in GitHub CI) fails on repo store data (builds with
  steps lacking estimates); pre-existing on main.
