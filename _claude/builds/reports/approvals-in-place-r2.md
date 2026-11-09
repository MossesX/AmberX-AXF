# approvals-in-place-r2

Build `console-approvals-in-place` (rerun), branch `claude/approvals-in-place-r2`, Opus.

## What Brett asked

"How come when I click approve, it's going back to axHub, not staying on console?" plus addenda 1-5 (nightly deploy,
refresh, UI Review choices, every option an asset, Appearance picker, three-option rule).

## What was found

Steps s1-s4 were ticked, but `claude/console-approvals-in-place` no longer exists and none of the code was on main, so
they were rebuilt here.

## Why it bounced

The hub takes a decision only with its own Origin and the session's CSRF value. A page on `console.amberxai.com` can't
send that, so every Approve fell through to `window.open(<hub page>)` or a framed hub page.

## What changed

- **Relay:** `POST /api/plugins/approvals-banner/decide` posts the tap to the hub with the `axhub_session` cookie the
  same browser sent, and returns the answer. The console already receives that cookie (it is domain-wide, the sign-in
  wall reads it). The hub records it as `web:<him>`, audit unchanged, and axHub needed no change.
- **One deciding path:** the relay is lent through the same seams AmberX's phone uses, so the banner, menus, review and
  veto dialogs and Follow Amber decide the same way. A failure shows where he tapped.
- **Review dialog:** no more framed hub page; it shows the call with Deny / Approve. "Open on axHub" stays as a separate
  link, the only thing that opens a tab.
- **AmberX:** new native `approvalDecide` approves and declines in place. Older APKs still open the hub view.
- **UI Review approve:** no change needed. It was already a console API call and never touched the hub.
- **approvals-no-window-spam s1:** covered here. The window spam was these same fallbacks. Its veto policy steps (s2, s3)
  are not done: they belong to `claude-settings-tabs-veto`.

## Security

The relay sends the hub's Origin from the server, which is exactly the check the hub uses to keep decisions on its own
pages. It stays Brett's own tap because:

- only a browser the wall signed in as a hub admin is accepted, and it must carry the session cookie; the console token
  (every Claude session, MCP, CLI, AmberX's forwarding) gets 403;
- the route is same-origin and JSON only, and is left out of the plugin's commands;
- only that cookie is sent on, only to the wall's https hub, redirects refused, never logged;
- deciding actions are `personOnly`: out of the console catalog, refused by the client, and the browser side wants a
  real user activation. Without this, a session holding `control.console.write` could have run `approvals.approve-now`
  in his browser and approved its own call: the relay would have turned an old bounce into a real approval.

The hub cannot tell a relayed tap from a tap on its own page. That is a change in what its Origin check means, so
axHub's decision log should record it.

## Addenda

1. **Nightly:** `deploy/console-nightly.mjs`, cron every minute (installed by `install-console.sh`), New York time,
   settings `nightly.enabled` / `nightly.time`, same lock as the updater, log `/root/axf-builds/nightly-deploy.log`,
   alert either way, skipped when only `_claude/` changed. **Refresh:** `console.nav` act `refresh`, REST, MCP
   `console_refresh`, CLI `axf console refresh [--hard] [--all]`, voice through MCP.
2. **Choices:** ui-choices@1, Screens / Choices / Comments tabs, multi-pick in order, `choices/choose`, `choices/decision`,
   CLI `--choices` and `decision`. Grid: Date column, sortable Title / App / Date / Status.
3. **Assets:** every option saved, tagged by set. Multi-pick only for types in `MULTI_VIEW_TYPES`.
4. **Appearance:** Settings → Appearance → Choose from every asset. One row per asset type (preview with Keep / Undo,
   reset). REST, MCP, CLI and voice use the existing `swap:<type>:<id>` action.
5. **Rule:** at least 3 options, setting, ask prompt with timeout, RULES.md + brief template.

## Known gaps

- **Not exercised against the live hub.** The relay is tested against a fake hub with its exact rules. The first real
  tap after deploy is the proof.
- **Not built, Addendum 4 per-UI picks:** the picker is per asset type, not per UI instance. Per-row picks exist only for
  chrome (right-click → Change…).
- **Multi-view switching:** choosing several records them in order; rendering them as a switchable view is each build's
  job, there is no shared view switcher yet.
- **Multi-view types are a list in code**, not a property of `asset-types.json`.
- **The three-option rule refuses builds at intake** (`source` headless / agent, `build:` / `agent:` senders) unless they
  send choices or `--single-option`. Manual uploads and predicted items pass. `rebuild-shots --submit` does not pass
  either flag yet, so a headless run of it is refused until it does.
- **Schema changed on Opus:** ui-review-item@1 gained `choices` + `singleOption`, and `ActionMeta` gained `personOnly`.
  Under the Fable rule these want a Fable review.
- **Option assets that arrive through the API** live in the console's data folder, not in a repo; only CLI ones ship in
  a PR. An option with an empty `data` may fail its type's validator and then stay out of the library.
- **Shared files:** RULES.md and BRIEF-TEMPLATE.md are edited in the repo only; `claude-sync` holds both, so the hub copy
  needs Brett's pick once this lands.
