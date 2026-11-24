# Fix: refreshing the console jumps back instead of staying put (draft report)

## s2: the console locking up (won't scroll) after an update

Method: read through `apps/console-web/src` and `framework/react` (the console builds from its baked copy,
`apps/console-web/src/axf/react` and `apps/console-web/src/axf/ui/axf.css`; `framework/ui/axf.css` is identical at the
lines below). Static trace only: nothing here was reproduced on a phone.

### Result

There is no scroll lock to leave behind. Nothing in the console or the framework sets `overflow: hidden` on `html`,
`body` or `#root`, adds a lock class to them, or installs a `touchmove` / `wheel` blocker, and there is no
pull-to-refresh handler: the pull-down refresh is the browser's own. So the lock-up is not a stale lock; it is the
layout handing the gesture to the wrong scroller. The causes, most likely first:

1. **Pull-down is not contained, anywhere.** `apps/console-web/src/axf/ui/axf.css:128`
   (`html, body, #root { height: 100%; margin: 0; }`) sets no `overscroll-behavior`, and neither does the page's
   scroller, `.fx-main` at `axf.css:432` (`overflow: auto`). The document itself never scrolls (`.fx-shell` is
   `overflow: hidden`, `axf.css:414-422`), so every downward drag that `.fx-main` cannot take (it is at its top, or the
   finger started outside it) chains to the viewport and becomes the browser's pull-to-refresh. That is the
   accidental refresh behind the jump back, and while the browser owns that gesture the page does not scroll.
2. **The banner stack is its own scroller above the page.** `axf.css:164`
   (`.fx-frame-banners { max-height: 45vh; overflow: auto; … }`) is a sibling of the shell, not an ancestor of
   `.fx-main`. After an update more banners show (builds live, systems check, codebase changes), so up to the top 45%
   of a phone screen is this region. A drag that starts there scrolls the banners, or, when they fit, nothing at all
   (downwards it triggers pull-to-refresh, cause 1). The page under it stays still: this is the most likely "won't
   scroll after an update". It has no `overscroll-behavior: contain` either.
3. **The update notice sits over the page and cannot be dismissed.** `apps/console-web/src/console.css:266`
   (`.axf-new-version`: `position: fixed`, bottom, `z-index: 300`, nearly full width on a phone), drawn by
   `NewVersionNotice` at `apps/console-web/src/pluginLoader.tsx:589-598`, mounted at `apps/console-web/src/App.tsx:216`.
   It appears once a redeploy removed a plugin chunk (`markStale`, `pluginLoader.tsx:160`, set at `:286` and `:552`)
   and stays until a reload. It is above everything, including dialogs (70) and the phone's bottom nav, and a drag
   that starts on it does not scroll the page. In the same stale state the open plugin page is replaced by a short
   error (`pluginLoader.tsx:574-582`), so there is also nothing left to scroll until the reload.
4. **A dialog open at the moment of a reload leaves its history entry.** `framework/react/components/Overlays.tsx:49`
   pushes `{ axfDialog: true }` and only its cleanup (`:53-57`) removes it. A reload (pull-down, the Reload button, a
   pushed refresh) skips the cleanup, so the entry survives with the dialog closed: the next Back press does nothing.
   No scrim is left: the backdrop (`axf.css:1054`, `Overlays.tsx:92`) only renders while a dialog is open, and dialog
   state is not saved (`core/runtime.ts:483`).

### Checked and ruled out

- `body.axf-dnd-dragging` (`apps/console-web/src/axf/libs/dnd/index.tsx:87`, removed at `:102`): only changes the
  cursor and text selection (`libs/dnd/dnd.css:3`), and both `pointerup` and `pointercancel` remove it.
- `html[data-axf-strip='on'] .fx-main { overflow: visible; }` (`axf.css:169`) would stop the page scrolling, but the
  attribute is only set by the embedded banner-strip page (`framework/react/components/BannerStrip.tsx:77`, removed at
  `:78`), which the console's own shell never mounts.
- Arrange mode (`touch-action: none` on every widget, `axf.css:343`) is not saved: it ends on reload
  (`core/runtime.ts:1595`).
- Full-screen layers: the Watch live sheet (`axf.css:1789`), the plan lightbox (`console.css:91`,
  `views/Plan.tsx:403`) and the dialog backdrop all need an explicit open and none is restored after a reload. The
  help layer, ashes layer and toast stack are `pointer-events: none`.
- Dialog title-bar swipe (`Overlays.tsx:61-78`) captures the pointer on the title bar only and releases on up / cancel.

### Suggested fix (for the fix steps; not made here)

- `overscroll-behavior-y: contain` on `.fx-main` and `.fx-frame-banners`, and `overscroll-behavior-y: none` on
  `html, body`, in `framework/ui/axf.css` (then re-bake the console copy). This stops the accidental pull-to-refresh
  and the dead zone over the banners. It also removes the browser's pull-down refresh, so decide whether a deliberate
  one replaces it.
- Give `.axf-new-version` a dismiss, or keep it clear of the phone's bottom nav.
- On load, drop a leftover `axfDialog` history entry (`history.state?.axfDialog` with no dialog open).

### Related, for the jump-back steps

`framework/react/AppShell.tsx:91` scrolls the main pane to the top whenever `state.view` changes, including the first
render after a reload, and `:169` keys the page on `state.view`, so any refresh that re-sets the view remounts it at
the top. The console's baked copy has the same code at the same lines.
