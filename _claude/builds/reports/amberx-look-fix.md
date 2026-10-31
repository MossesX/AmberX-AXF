# AmberX look fix — report (Oct 31 2026)

Headless build for Brett, Opus, one session. Branch `claude/amberx-look-fix` (AmberX-AXF) and `main` of MossesX/axHub.
Source: Brett's screen recording (Oct 31 19:39, AmberX at https://amberx.amberxai.com, phone), three bugs.

## 1. AmberX ignores the shared look (light, generic Approvals/hub screens)

| Thing touched | What was wrong | What changed |
| --- | --- | --- |
| axHub's projects tree on the VPS (volume `…-axhub-projects`, mounted at `/projects`) | **Root cause.** axHub redeployed at 23:36 UTC and from then on read `/projects/_shared/_data/…`, but every file written before that sits one level down in `/projects/projects/…` (a nested copy, last written 13:50). The hub's shared look document `shared/settings/appearance.json` was therefore a 145-byte stub holding only `layout: classic-ide` (written by axhub-web 2 s after the deploy). With no palette, colour theme, style theme or spacing in it, every developer app fell back to its own default; AmberX's default design package is *AmberX · Day*, which is light. The hub's own pages (the framed approval page) lost the palette too. | Wrote the full document back **through the hub's data API** (bearer, `If-Match`), so the `/data-events` SSE feed pushed it live to every app: the Oct 31 08:17 look (design package `neon-night`, colour theme `neon-tide`, style theme `glass-orbit`, dark palette, `spacing: tight`, 40 slots) merged with the newer `layout: classic-ide`. |
| Same tree: other data left behind | 485 files existed only in the nested copy: `_shared/_data` (per-app hub settings incl. `settings/apps/amberx-droid.json`, DNS log, app-catalog APK index, handoff runs) and `amberx-axf/_data` (changes log history, sessions archive, plan-studio, Vinny agent, notes). | Copied them back into `/projects/<name>/_data` with no-clobber (`cp -an`): only missing files were added, nothing newer was overwritten. Verified `GET /data/shared/settings/apps/amberx-droid.json` → 200. The nested `/projects/projects` copy is left in place (nothing deleted). |
| `apps/amberx-droid` code | Checked: `src/main.tsx` already attaches `HubAppearanceSource` (manifest `developer.hub`), the baked framework was current, `check-theme` is clean and every slot id in the doc ships with AmberX (only `app-menu:console`, `appearance-package:fresh`, `branding:gizmox`, `interface:amberx-signature` are skipped, same as axhub-web). The code was right; the data was gone. | Regression test in `apps/amberx-droid/test.mjs`: main attaches the hub appearance source and the manifest names axHub as the developer hub. |

**Open question for whoever owns the axHub deploy:** what moved the data into `/projects/projects` (or changed the root) at the 23:36 redeploy. The data is whole again under `/projects`, which is the layout `deploy/coolify.md` documents; if a later deploy points the hub back at the nested folder, the same symptom returns.

## 2. "Approval waiting" popup shows a broken frame

| Thing touched | What was wrong | What changed |
| --- | --- | --- |
| axHub `packages/server/src/embed.ts`, `web.ts` | `frame-ancestors` came only from `AXHUB_APPROVALS_FRAME_ANCESTORS` (= console) and `AXHUB_EMBED_FRAME_ANCESTORS` (= patches); `https://amberx.amberxai.com` was refused, so the iframe showed the broken-frame icon. | `DEFAULT_FRAME_ANCESTORS = ["https://amberx.amberxai.com"]`, joined to both lists (`approvalFrameAncestors()`, `embedFrameAncestors()`), kept **only when `AXHUB_COOKIE_DOMAIN` covers it** (same site, so the Lax session cookie reaches the frame; a hub on another domain gets nothing). Still https only; `AXHUB_FRAME_DEFAULTS=off` drops it. The `/apps` page list reuses the same parser (`frameOrigins`). No Coolify env change needed. Decision #107 (axHub `CLAUDE.md`). |
| axHub `test/embed.test.ts` | — | New test: default only under the cookie domain (`.amberxai.com` / `amberxai.com` yes; `.example.com`, `.notamberxai.com`, none, `off` no), listed origins kept https-only, default joined once. |
| `apps/console-web/plugins/approvals-banner/web/index.tsx` + `.css` (the `approvals.review` "Approval waiting" dialog, loaded in AmberX too) | A refused frame stayed a dead frame with a small "Blank? Open it on the hub" link. | The frame gets `FRAME_LOAD_MS` (8 s) to load; if it never does, the dialog swaps it for a card (shield icon, the tool, one sentence) with a primary **Open on the hub** button. A visible **Open on the hub** button also sits under the frame while it loads. On the phone it opens in AmberX's signed-in hub view (`vetoHost().open`), else a new tab. Theme tokens only. |

## 3. Pushes show raw JSON and ring again and again

| Thing touched | What was wrong | What changed |
| --- | --- | --- |
| axHub `packages/server/src/vinnie.ts` (`ntfyVetoSender`) | The ntfy `message` was `JSON.stringify(payload)`, so the phone showed `{"type":"veto","phase":"warning",…}`; held and warning went at priority 5, running and shelved at 4: three or four loud notices per call. | New `ntfyVetoMessage()`: title = the call's reason title; body = one line (`Runs in 1:30 unless you deny it. Tap to review.` / `Runs in 30 s, tap to deny.` / `Shelved: waiting for you. Tap to approve or deny.` / `Running now.` / `Handled: nothing more to do.`) plus the redacted command on line two. Only `held` (4) and `warning` (5) make a sound; running/shelved (2) and cleared (1) are quiet. `click` = approval page; buttons Deny / Approve now / Shelve unchanged. |
| axHub `vinnie.ts` (`Vinnie.countdown`, `listen`) | The phases already sent lived only in memory, and the first countdown after a start re-sent `held` "in case it was missed": every redeploy (several today) re-rang every held call, and a call already in its warning window rang held + warning at once. | Vinnie records when it started. A call held before then gets no second `held`; a warning window that opened before then gets no second `warning`; a call first seen inside its warning window (also a countdown shorter than its warning) gets one notice, the warning. |
| axHub `test/veto.test.ts`, `docs/veto.md` §7, `CLAUDE.md` | — | Tests: readable text per phase and priorities; a restarted Vinnie pushes nothing again; a late call gets only the warning; the ntfy body test now checks the text. Docs updated. |
| `framework/libs/hub/veto.ts` `notifyPlan` (baked into AmberX, console, axhub-web, walkthrough-studio) | The browser notices' "sent" list kept only calls in the current read, so one read that missed a call (hub hiccup, a redeploy) wiped it and the next read sent the notice again. | Entries stay after a call leaves the list (capped at 600, oldest out). Test in `apps/amberx-droid/test.mjs`: a call missing from one read doesn't ring again, and the warning still comes once. |
| `apps/console-web/plugins/approvals-banner/web/veto.tsx` (veto alarm in the page, AmberX + console) | The "already alarmed" set dropped a call the moment a read missed it, so its alarm could start again. | Kept (oldest dropped past 200). |
| `apps/amberx-droid/src/plugins/monitor/web/index.tsx` (browser monitor) | A failed read (empty list) reset the seen list, so the next good read raised "Approval waiting" for everything again. | The seen list only moves on a good (`ok`) read. |
| AmberX Android (`WatchService`, `VetoAlerts`, `VetoAlarm`) | Checked, unchanged: acts only on `ok` reads, one card per phase (`sent` set in prefs), the alarm keeps a `rang` list. | — |

## Also fixed (main was red)

- `apps/console-web/plugins/plan-studio/web/voice.ts`: `who[0].toUpperCase()` failed `tsc` (`noUncheckedIndexedAccess`), so the console build failed on main; now `who.charAt(0)`.
- `apps/console-web/plugins/output-recorder`: its `test.mts` (run with `node --experimental-strip-types`) couldn't load `web/store.ts` (extensionless `./core` import). Import is `./core.ts`; console `tsconfig.json` gets `allowImportingTsExtensions` (it is `noEmit`).

## Tests

- axHub `pnpm test` (Node 22): **477 passed / 477** (was 473; +4 new, 1 rewritten).
- AXF, CI web block in Node 22: framework validate, tracker, plugins, project manifests, fixtures, plugin catalog, build steps, profiles, check-theme, check-controls, check-plugin-pages; builds of amberx-droid, console-web, axhub-web; check-alerts, check-widgets, check-appearance, check-appearance-lock, check-hub, check-embed, check-banner-hide, menu-reach; axhub-web and amberx-droid `test.mjs`; every plugin `test.mts` — all pass. Before: console-web build and output-recorder test failed on main.
- Plugin lifecycle check: passes on the committed tree; locally it flags git-ignored `_claude` sync copies and untracked hook files only (CI never sees them).

## Not done / follow-ups

- No UI Review screenshots were taken in this headless run (the only visible change is the Open-on-the-hub card in the review dialog).
- Root cause of the 23:36 data split (see bug 1) is not known; worth a systems-check item that compares `/projects/<name>/_data` with a nested `/projects/projects` tree.
