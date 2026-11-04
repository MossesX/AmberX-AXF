# UI Review shows its pictures again (`ui-review-shots`, Urgent)

Brett, Nov 3 2026 (voice): UI Review shows items but no pictures. Agent: Snap Sully. Model: Opus. Branch
`claude/ui-review-shots`.

## s1 Cause

The pictures were never lost. All 33 open items have every file in the live store
(`/opt/axf/.axf-console/plugins/ui-review/shots/<id>/`, a bind mount, so it survives redeploys and worktree
deletes), and the console served every `/shot` request it got with 200. Two things stopped them from showing:

1. **A status request storm starved the picture fetches.** `agent-slots` (`web/index.tsx`) and `token-control`
   (`web/pass.tsx`) passed an inline `subscribe` to `useSyncExternalStore`. React re-subscribes whenever that function
   changes, which was every render. With one consumer, unsubscribing stopped the poll timer and re-subscribing called
   `load()` at once. Each answer re-rendered and fired the next call. The live log showed Brett's browser sending
   **35,308 `agent-slots/status` + 10,411 `token-control/pass/status` calls in 30 minutes** (about 2,700 a minute).
   The console sat at ~195% CPU, and UI Review's picture fetches queued behind the flood. In a headless browser
   against the live bundle, 18 picture requests were still unanswered after 25 s, with 110 + 82 status calls in
   flight.
2. **On a phone the preview had zero width.** Today's `layout-adopt` codemod (token-control s2) turned
   `@media (min-width: …)` blocks into `:where(:not([data-fx-narrow])) .x`. That matches whenever *any* ancestor
   lacks the attribute (`<html>`, `<body>`), so it is always true. The wide three-column item layout therefore applied on
   phones too, and the picture column collapsed to nothing.

Not the cause: auth (the blob loader sends the console token; 200s in the log), paths (every `src` is
`items/<id>/<file>` in the shared store) and worktree submits (no worktree holds a stranded item;
`review.mjs --console` uploads the bytes at submit time).

## s2 Fix

- `agent-slots/web/index.tsx`, `token-control/web/pass.tsx`: the subscribe and snapshot functions now live at module
  level, and there is one request at a time (a call made meanwhile runs once after the current one finishes). After
  45 s on UI Review the browser sent **8** agent-slots and **7** pass calls (the 5 s poll), down from ~2,000.
- `ui-review/server`: `GET shot` is `async`, so it is served on the event loop and never waits in the threadpool
  behind slow sync routes.
- `ui-review/web/shots.tsx`, `screenshots.tsx`: each picture fetch has a 20 s timeout and one retry (none on 404). A
  failure is reported to the server.
- `ui-review.css`, `todo-manager.css`, `amberx-droid/.../walkthrough.css`: the wide-only selectors are anchored on the
  themed root, `:where([data-fx-scheme]:not([data-fx-narrow]))`. `framework/cli/layout-adopt.mjs` now writes that
  form, and `check-layout-tokens.mts` expects it.
- `review.mjs submit` without `--console` in a git worktree warns that the item stays in that worktree.

## s3 Backfill

Nothing to re-attach. Every open item already has all its files in the shared store, and no build worktree
(`/root/axf-builds/*`, `/home/axfbuild/*`) holds items that are missing from the console. Once the console runs this
branch, the existing items show their pictures.

## s4 Health + UI

- health@1 check **`ui-review-shots`** ("UI Review pictures load", order 62):
  - **red** when any open item's picture is missing, empty or not a PNG/JPEG/WebP, naming the items;
  - **amber** when a browser reported a picture it couldn't load in the last 15 minutes (`POST shot-failed`), even
    though the file is on disk.
  - `GET audit` lists the broken ones.
- Item rows keep their thumbnail. A broken picture shows a red dashed **Shot missing** box, never a blank. The main
  preview adds **Re-capture**, which calls `POST recapture` and hands that item's app and screen to the agent who owns
  the `ui-screenshots` job (`agent-job.mjs`), plus **Retry** when the file is on disk but didn't load.

## s5 Tests

- `python3 apps/console-web/plugins/ui-review/test.py`: 155 → **173** checks. The 18 new ones:
  - submit from a fake worktree, delete the worktree, and the picture still loads byte-for-byte; its `src` points into
    the shared store;
  - audit and health go red, naming the item, when a picture is deleted or isn't an image, and back to ok when it's
    restored;
  - `shot-failed` gives amber and refuses bad paths; recapture of an unknown item answers 404; the shot route refuses
    path tricks;
  - both pollers use a module-level subscribe and an in-flight guard.
- `npx tsx apps/console-web/plugins/ui-review/test.mts` 23 ok; `tsc --noEmit` (console-web) clean;
  `check-theme`, `check-controls`, `check-layout-tokens` (412) green.

## Screens

This checkout's console was run with a copy of the live UI Review data, with one picture deleted on purpose. The
screens are in UI Review (group `ui-review-shots - Nov 3 7:50 PM`): the review list with thumbnails, an item open
(desktop + phone, picture visible), and the Shot missing state with Re-capture.

## Left

- The fix reaches Brett when the console is redeployed from main (on merge).
- Re-capture files the new pictures in the screenshots agent's group. Re-attaching them to the original item is a
  manual step (Send to review).
