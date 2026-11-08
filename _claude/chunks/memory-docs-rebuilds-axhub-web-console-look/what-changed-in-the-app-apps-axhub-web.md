<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/axhub-web-console-look.md lines=21-40 tokens=469 -->
## What changed in the app (`apps/axhub-web`)

- **Banner** = the console's `amberx-thin` (logo, search in the middle, day/night switch and clock on the right) plus the
  **approvals counter** (`counter/approvals`, "2 waiting", hidden at zero, tap → Approvals), attached at run time like
  the console's alerts bell. Removed before: no theme switch, no count.
- **Layout** `axhub-console` (new, default): menu bar under the banner, toolbar + left nav kept (Brett's pick), no
  inspector, no status bar, content 920 px like the console. `classic-ide` and `studio-dock` stay as choices.
- **Toolbar** `axhub-web` (new, default; replaces the generic `standard-icons` / `labeled-actions` / `text-commands`
  starters, which offered New file / Undo / Cut that do nothing here): Approvals with the waiting badge, Hub, Apps,
  Check now, Approvals on the hub, next colour / layout, Settings, and the console's live search box.
- **Application menu** `axhub-web` 1.0.0, laid out like the console's: AXHub (Approvals with badge, Hub, Search
  everything, Settings + Settings pages ▸, Account, Check now, Hub pages ▸, About), **Approvals** (All approvals,
  **Waiting for approval ▸** live list, on the hub), **Apps** (catalog, **Download the latest ▸** live list, on the hub),
  Manage (unchanged), View (Toolbar / Side navigation / Banner check marks, All bars and menus ▸, Look ▸, Spacing ▸,
  Appearance settings, Assets, Every page ▸, Navigation / Toolbar items ▸, Windows ▸, Dialogs ▸), Help.
- Pages keep their console structure (`fx-pagehead`, eyebrow, cards); Approvals now draws its cards and notes with
  lib-hub's `HubApprovalList` / `HubStatusNote`.
- Actions: `axhub.open:<page>` → lib-hub's `hub.open:<page>`; new `axhub.search` (focuses the live search box);
  `axhub.check` fires lib-hub's `checkHubNow()`. The framework was re-baked into `src/axf` (lock regenerated).
