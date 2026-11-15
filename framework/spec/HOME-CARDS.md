# HOME-CARDS — home-cards@1, the resolver that keeps Home full

Status: contract since Nov 15 2026 (build `home-cards-follow-plugin-off-home-always`, Fable phase). Brett: "When I
disable plugins, the home cards need to be disabled as well. They need to be removed, and other ones need to replace
them. The home screen always needs to be filled with some plugins, even if I don't have some selected. Yes, I can select
which ones I want, but if I don't, you need to pick some. Pick the most active."

Reference engines (pure, no I/O, no language model): `framework/core/engines/home-cards.mjs` (`resolveHomeCards`,
`normPicks`, validators, `jsonSchemas`) and `framework/core/engines/plugin-activity.mjs` (`scoreActivity`, `rankedIds`,
`normEvent`). Registry: `framework/schemas/home-cards.json`. JSON Schemas: `schemas/json/home-picks.schema.json`,
`home-cards.schema.json`, `plugin-activity.schema.json` (the event frame sits in its `$defs.event`). Fixture:
`framework/spec/fixtures/home-cards.json` (`spec/check-home-cards.mjs`). Kotlin twin deferred (PORTING.md).

## What it sits on

`home-layout@1` (card-rules.mjs, HomeCards.tsx) already draws cards: each card binds one plugin read. It knows nothing
about whether that plugin is still enabled, and an empty layout stays empty. home-cards@1 sits one step before it and
answers a smaller question: **which plugins hold a slot on Home right now, in what order, and why**. The console phase
of this build turns each answer into a card@1 (the plugin's starter card, else `cardForSource` on its first read) and
hands the list to the layout. The resolver itself never sees a card, a read or a colour.

## The frames

| Frame | Who writes it | Shape |
| --- | --- | --- |
| `home-picks@1` | Brett (the picker, `home.picks_set`, voice) | `{ $axf, slots, plugins: string[], at?, updatedBy? }`. `plugins` are plugin folder ids in **his order**; a pick is a pin. `slots` 1–24, default 6. An empty `plugins` is the normal state: Home is then all auto. |
| `plugin-activity-event@1` | The console, as things happen | `{ plugin, kind: open \| action \| job \| alert, at, n? }`. `open` = the plugin's screen opened; `action` = one of its commands ran (REST, MCP, CLI, voice or UI, all the same); `job` = a live job started or is running under it; `alert` = it raised an alert or banner item. `n` batches repeats (default 1). |
| `plugin-activity@1` | The ranking engine | `{ $axf, plugin, at, window: { days, halfLifeDays }, counts: { open, action, job, alert }, score }`. One record per plugin; a list of them sorted by score desc then id asc **is** the ranking. |
| `home-cards@1` | The resolver | `{ $axf, at, slots, cards: [{ plugin, mode: pinned \| auto, rank, score }], dropped: [{ plugin, why }], short }`. `rank` is 1-based position. `dropped` says what did not make it and why (`disabled`, `uninstalled`, `duplicate`, `invalid`, `overflow`). `short` is how many slots stayed empty because fewer enabled plugins exist than slots: the only way Home is ever not full. |

## The resolver — `resolveHomeCards({ picks, plugins, activity, slots?, at? })`

Inputs: `picks` (home-picks@1 or a bare id list), `plugins` (the plugin inventory as `[{ id, enabled }]` or a list of
enabled ids; **not in the list = uninstalled**), `activity` (plugin-activity@1 records or `{ id: score }`), `slots`
(overrides `picks.slots`), `at` (ISO, for the output stamp; defaults to now).

Rules, in this order. Every one is a golden fixture in `fixtures/home-cards.json`:

1. **Slot count** = clamp(`slots` ?? `picks.slots` ?? 6, 1, 24).
2. **Pins first, in Brett's order.** Each pick is kept if its id is valid, installed and enabled; otherwise it goes to
   `dropped` with `invalid`, `uninstalled` or `disabled`. A repeat id is `duplicate`. Pins past the slot count are
   `overflow`. A dropped pin is **not forgotten**: picks are stored as Brett wrote them, so re-enabling the plugin puts
   its card back in its place on the next resolve.
3. **Free slots fill with the most active enabled plugins** that are not already pinned: score desc, then id asc (stable,
   so two ports agree and a tie never shuffles Home). A plugin with no activity still scores 0 and still qualifies:
   an empty selection on a quiet install fills every slot.
4. **Never a gap.** Pinned cards hold their positions; auto cards take the rest in rank order. `cards.length` is
   `min(slots, enabled plugin count)`; `short` is the remainder.
5. **Disable removes the card and the next-ranked plugin takes its place**; the auto card that replaced it drops off
   the end again when the plugin is re-enabled. Changing `slots` grows or trims the auto tail only; pins are trimmed
   only when fewer slots than pins (`overflow`).

The resolver is deterministic: same inputs, same output, byte for byte. It is the one place Home's membership is
decided; the UI, the console API, MCP, the CLI and voice all call it and never reimplement a rule.

## The ranking — `scoreActivity(events, { at, windowDays, halfLifeDays, weights, plugins })`

`score(plugin) = Σ over its events inside the window of  weight(kind) × n × 2^(−ageDays / halfLifeDays)`.

Defaults from the registry: window 14 days, half-life 3 days, weights open 1, action 2, job 3, alert 2. Events older
than the window are ignored; events stamped in the future count as age 0. `plugins` (optional) lists ids that get a
zero record even with no events, so the ranking covers every enabled plugin. Scores round to 4 decimals (fixture
stability). `rankedIds(records)` gives the ids in rank order. Weights and window are settings (Settings → Plugins →
Home cards, and `home.settings_set`); the engine takes them as options, the registry only holds the defaults.

## `home.*` — how it is reached (console phase builds these; all five surfaces the same)

| Tool | Policy | Input | Output |
| --- | --- | --- | --- |
| `home.cards` | read | `{}` | `home-cards@1`: what Home shows now and why each card is there |
| `home.picks_get` | read | `{}` | `home-picks@1` |
| `home.picks_set` | write | `{ plugins?, slots?, by, reason }` (partial; order is the order given) | `{ ok, picks, cards: home-cards@1 }` |
| `home.pin` | write | `{ plugin, at?, by, reason }` | `{ ok, picks, cards }` (append or insert at `at`) |
| `home.unpin` | write | `{ plugin, by, reason }` | `{ ok, picks, cards }` (the slot refills by rank at once) |
| `home.slots_set` | write | `{ slots, by, reason }` | `{ ok, picks, cards }` |
| `home.reset` | write | `{ by, reason }` | `{ ok, picks, cards }` (no pins, default slots: all auto) |
| `home.activity` | read | `{ windowDays?, limit? }` | `plugin-activity@1[]` in rank order |
| `home.activity_record` | write | `plugin-activity-event@1` (or a batch) | `{ ok, n }` (the console calls this itself on open / action / job / alert) |
| `home.settings_get` / `home.settings_set` | read / write | `{ windowDays?, halfLifeDays?, weights? }` | the settings |

Deep links: `console_show home` opens Home; `console_show home --dialog picks` opens the picker. Voice (AmberX): "pin
<plugin> on home", "take <plugin> off home", "what's on home", "home shows six". Every write carries `by` and
`reason: { title, description }` and is a confirm call on axHub, like every other home write. The plugin manager's
enable / disable switch does not call `home.*`: Home re-resolves from the inventory it already reads, so one source of
truth (the inventory) drives both the Plugin Manager and Home.
