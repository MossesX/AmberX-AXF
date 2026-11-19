# Remove the AmberX Android app (apps/amberx-droid)

Build `remove-amberx-app-code-once-phone`, Nov 19 2026, on the PR #853 branch (`claude/fix-main-ci-p2`) as asked.

## Archive first

- Tag `archive/amberx-droid-2026-11-19` at main `abda129dc` (the whole repo as it was).
- Branch `archive/amberx-droid`: one commit with only `apps/amberx-droid/` and a README (retired Nov 19 2026, kept so
  code can be harvested later).

## Removed

- `apps/amberx-droid` (Capacitor shell, web app, server, walkthrough recorder, its native audio-output recorder and
  Audio Extract services).
- `apps/console-web/plugins/audio-extract`: its only runtime was the AmberX app (the console only showed a note).
- CI: the `amberx` job ("AmberX - web app in the Capacitor Android shell (APK + native unit tests)"), the amberx-droid
  re-bake/build step in the console job, its web and server tests, the APK download into the app catalog bundle and
  `--skip apps/amberx-droid`; the `android` job now needs `scope` only. `ci-scope.mjs`: keys `amberxweb` and `amberx`
  and the `apps/amberx-droid/` rule.
- Plugin kind `amberx` (amberx-plugin@1) in `plugin-catalog.mjs`, `axf_server/plugin_package.py`, the console's
  app-plugins routes; `fixtures/plugin-package.json` regenerated.
- Every app list naming it: watch-live targets, ui-predict screens, help-coverage apps, plugin-commands homes (JS and
  Python), toolbar inventory, scale-adopt, check-plugin-pages, skins/animations/skin-gallery aliases, demonstration
  and glossary registries, md-studio skip paths, shared-assets apps, generated-files help outputs, chrome baseline.
- `amberx-droid` from the `targets` of ten console plugins.
- Gizmo guide: the "Re-record the AmberX walkthrough" panel and its `/amberx-walkthrough/rerecord` routes (the script
  it ran lived in the app).
- token-control: `gen-amberx-core.mjs` (its source is gone); the generated notes core is kept as `lib/amberx-core.mjs`.
- Spec checks that looped over the app (claude-session, listeners, hub-look, help, design-package, scale, xlayout,
  page toolbars, watch-live, plugin-commands, ci-scope).
- Docs and agent material: RULES.md (project list, Android exception), headless Watch-live note, WATCH-LIVE.md,
  DESIGN-LANGUAGE.md, CONTROL.md, PORTING.md, Gizmo/Molly add-on knowledge, swarm roster paths, Earl / listener-qa /
  companion / kotlin-compose skills, the listener-qa and walkthrough job types.

## Changed

- Audio Output Recorder keeps its console side (recordings list, transcripts, search); Phone Connect records on the
  phone and uploads to the same hub paths. Its native seam (`web/bridge.ts`) stays for a future phone shell; the hand-off
  to Audio Extract, the static checks of the AmberX Java files and the APK checks in `hooks.mjs` are gone.
- Glossary docs: a help entry for the Format field (Audio Extract's draft entry used to cover it).

## Kept on purpose

- Data and protocol compatibility: phone-connect@1 still accepts `app: "amberx-droid"` on a migrated device record
  (engine, schema, fixtures); the hub settings document `settings/apps/amberx-droid.json` (data-store paths, the
  AmberX listeners plugin's policies); listener rows default `app`. Changing these is a phone-connect@1 / data change.
- The `amberx` notification channel id (phone push, now Phone Connect) and the `amberx.*` axHub tool aliases that Phone
  Connect answers (`amberx.open_url`, `amberx.recorder_*`).
- History: shipped builds, reports, changes, sessions, build-breaker asks, plan data, What's shipped labels.
- Baked framework copies under `apps/*/src/axf` and `apps/phone-connect/.../assets/axf`: generated; CI re-bakes them.

## Follow-ups

- UI copy that still says "AmberX phone" where Phone Connect now does the work: console-commands wake, claude-badge
  phone badge, notify-control types, claude-session recording (`amberx.recorder_*` to `phone.recorder_*`).
- The AmberX listeners plugin reads listener rows only the AmberX app published; it shows nothing new until Phone
  Connect publishes listener@1 rows.
- The axHub `amberx` device service (recorder and open-url tools) is axHub's; retire it there once nothing calls the
  `amberx.*` names.
- `apps/console-web/plugins/agent-swarm/test.mjs` fails on the PR branch before this change too ("nothing posts for
  merge-queue"); it is not in CI.
