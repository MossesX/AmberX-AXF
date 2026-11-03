# home-cards-live: Home cards draw live data

Urgent build `home-cards-live` (Nov 3 2026, Brett, voice: "I shouldn't need to build cards. I should draw dynamic
data."). Agent: Ping Paulie (headless, Opus; every step Opus, no model switch). Replaces Angel build `home-cards`
(archived with a note pointing here): nothing is hand-built per plugin.

Branch `claude/home-cards-live`.

## What landed

### s1 card@1: a binding, not a design
- `framework/core/engines/card-rules.mjs` (+ `.d.mts`): ONE registry drives both validators (core `validate.ts` and
  the build engine), the normaliser, the schema (`schemas/json/card.schema.json`), the smart view pick, the view
  models, refresh, suggestions, drops and the Home layout. Pure, no I/O, no model.
- A card names its **source** (`{kind: command, plugin, command}` = any plugin read from the plugin-commands@1
  registry that control@1 already serves as REST/MCP/CLI, or `{kind: console, id}` = a read the host provides),
  `args`, a dotted `path` (with `*` to map over lists/objects), `where`, `reduce` (count, sum, avg, min, max, first,
  last), `view`, `chart`, `fields`, `refresh` (live / every N s / manual), `title`, `icon`, `size`, `limit`, `unit`.
- **Open view registry**: number, list, meter, chart (line / bar / spark), feed, table, status, panel (the host's own
  renderer); hosts add views with `registerCardView`.
- Asset type `card` in `asset-types.json` (`shared: false`, optional, never rolled). Kotlin twin deferred (Android on
  hold), recorded in PORTING.md.
- Renderer: `framework/react/components/DataCard.tsx` (`DataCard`, `CardBody`) inside the framework Container, CSS
  `.fx-dcard*` in `ui/axf.css`, tokens only (theme colours, density gaps, type scale, radii, opacity).

### s2 Add card (zero code, zero agents, zero tokens)
Home → **Add card**: Plugin → Read (every enabled console plugin's reads + the console's own) → input → path (top-level
keys offered as one-tap chips) → fold → keep only → **View** (Auto shows the pick, e.g. "Auto (Number)") → fields
per view role (auto-filled from the data's keys) → title, refresh, size → **live preview** → Add card.

### s3 Drag onto Home
Home is a drop target: a card draft (`application/x-axf-card+json`), a plugin read ref `{plugin, command}`, a control@1
path `plugins.reads <plugin>/<command>` as text, or a grid row hook `{kind, id}` opens the card dialog prefilled. Every
read on the Plugin commands page is draggable and has **Add to Home**; Suggested cards are draggable too. The shared
`hook@1` / `drop-target@1` contract from the toolbar build is **not on main yet**, so Home reads the same payloads
itself (`cardFromDrop`); when the contract lands, Home registers as its drop target with no change to the engine.

### s4 Home layout, per user on axHub
- `GET|PUT /api/home/layout` (console server): `home-layout@1` kept at `/projects/<project>/_data/home-cards/<user>.json`
  (`owner.json` for the console token and hub admins; `user-<name>.json` for other hub users); a local copy keeps Home
  drawn when the server is away. The label on Home says where it is saved.
- Drag a card onto another to reorder; card menu (right-click, long-press or ⋯): Edit card (a starter is edited as a
  copy in its place), Change view, Size (Small, Medium, Tall, Wide), Open plugin, Hide, Remove. Toolbar: Add card,
  Suggested cards, Show all (n hidden), Hide all.
- The five existing Home cards are card@1 assets in `apps/console-web/src/assets/card/`: Plan summary and Build summary
  (`panel` view: the pages' own summary panels), Coverage (meter of `tracker.coverage`), Project (table of
  `console.project`), Recent installs & imports (list of `console.ports`). Starters can be hidden, never removed.

### s5 Suggested cards
`CARD_SUGGESTIONS` names candidate reads per suggestion; the first one the live registry has is offered, otherwise the
suggestion is left out. On this checkout: Builds running (builds-page progress → active, count), Build progress (meter
done/total), Agent spend today (agent-swarm state → spend.*.today.usd, sum, USD), Agents working (state.runs, count),
UI Review waiting (ui-review items where status = waiting), Recent notes (notes-browser feed), Codebase changes
(codebase-changes items feed). One tap each or **Add all**; × dismisses one (saved).

## Tests

| check | before | after |
|---|---|---|
| `node framework/spec/check-card.mjs` (new, in CI) | – | 9 checks: validators agree, open view registry, live refresh channels, starters valid, drops, layout ops, suggestions from what exists, **zero tokens** (no LLM import or model endpoint in card-rules, DataCard or HomeCards), fixture |
| `spec/fixtures/card.json` | – | 15 view models, 8 shapes, sources, suggestions, 8 layout steps |
| `axf validate --framework` / `apps/console-web` | not run | 492 / 514 valid (the console's 5 new starter cards) |
| `check-theme.mjs`, `check-controls.mjs` | not run | pass |
| `plugin-commands/test.mjs`, lifecycle check | not run | 41 checks / clean |
| `shared-assets.mjs check` | not run | pass (4 apps) |
| console `tsc --noEmit`, `vite build` | not run | pass |

"Not run" = not measured on the starting commit in this session; every check above passed on this branch.

Verified end to end against a local console server (data dir in /tmp, so no hub data written): starters render, the
suggestions come from the real registry, Add all draws live values (builds running 2, steps 77/126, notes and changes
feeds), the card menu opens, and the phone viewport shows the cards added on desktop (same per-user layout on the server).

## Known gaps
- **Approvals waiting**: approvals-banner exposes no read of waiting approvals (only its data folder), so that
  suggestion is not offered. A `GET /pending` route on approvals-banner (or an `approvals` plugin read) makes it appear
  by itself.
- Slow reads under VPS load: each control@1 read runs two node processes on the console server; cards on the same
  source share one read (3 s window). A faster in-process path for reads would help every surface, not just Home.
- Non-admin hub users: the axHub wall may refuse `/api/home/layout` for them until it is added to the wall's user paths.
- Live refresh listens to the console's `/api/events` feed by plugin channel, with a 2-minute fallback re-read; plugins
  that never log on the feed refresh at that pace or by hand.
- Kotlin card engine deferred (Android on hold).

## Screenshots
UI Review group `home-cards-live - Nov 3 <time>` (desktop 1280 + phone 412): Home with starters, Suggested cards,
after Add all, the Add card dialog, the card menu.
