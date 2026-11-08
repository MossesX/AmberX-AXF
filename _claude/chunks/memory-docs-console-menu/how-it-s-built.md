<!-- memory-chunk@1 source=_claude/memory/docs/console-menu.md lines=41-61 tokens=423 -->
## How it's built

| Piece | Where |
|---|---|
| Static menus | `apps/console-web/src/assets/app-menu/console.json` (explicit `order`s so plugin entries slot in) |
| Console contributions (chrome toggles via `chromeToggleItems`, All bars and menus) | `src/menu.ts` (pure) |
| Console library: live lists, `pending.open` badge, actions, search dialog, rescue note, migration | `src/menuLibrary.tsx` |
| Plugin entries | `plugins/<folder>/web/menu.ts` (pure data) → `appMenu` in `web/index.tsx` |
| Reachability check (CI) | `apps/console-web/scripts/menu-reach.mts` |

Live lists: `console.pending` (open pending items → Pending builds, row flashed), `console.queue` (steps not done →
Build queue, row flashed), `console.features` (plan features not built → feature window), `console.libraries`,
`console.modules`, `console.boilerplates` (→ the page, row flashed / picked), `console.plugins` (→ Plugin Manager),
`build-manager.remaining` (→ Build manager row), `approvals.list` (→ the review dialog; since Nov 1 2026 each row also carries red Deny + green Approve, framework AppMenu row `buttons` + provider `act`), `app-tabs.tabs`; plus the
framework's `views`, `nav`, `toolbar`, `settings`, `windows`, `dialogs`, `chrome`.

New actions: `console.search`, `console.open:<pilot|demo|axhub|axhub-approvals|axhub-apps|axhub-users|axhub-account|plugin-guide|docs>`
(fixed list, new browser tab), `console.reveal:<view>:<text>[:pick]`, `console.pending.open:<id>`,
`console.queue.open:<id>`, `help.docs`, `plugin-manager.install`, `approvals.review:<id>`; `app-tabs.show:<id>` now
adds a known app to the tab bar first. Badges: `pending.open`, `approvals.waiting` (+ the existing `alerts.unread`).
