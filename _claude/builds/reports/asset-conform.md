# asset-conform: handwritten and generated code conforms to the asset system

Oct 31 2026 · Opus · headless VPS build · branch `claude/asset-conform`

**Brett's rule:** handwritten code is allowed only if it conforms to the hot-swappable asset system. Anything the build
system makes (templates, boilerplates, the plugin generator, Build Pilot, orchestrator/headless builds) is generated from
framework controls + assets. Test: swapping any asset restyles the code with no edits.

## What changed

| Area | Before | Now |
|---|---|---|
| Rule | not written down | `_claude/shared/rules/RULES.md` → "Code must conform to the asset system"; mirrored in `CLAUDE.md`, `framework/spec/THEMING.md`, `apps/console-web/plugins/README.md` |
| `framework/cli/check-theme.mjs` | strict rules only for libs, plugins, console `src`; framework React/CSS, other apps and templates got colour rules only; demo skipped; no Kotlin | **every** web UI path strict (framework React + CSS, every app's `src` incl. demo, templates, boilerplates, library templates); new rules: rem sizes, em spacing, border widths, literal fonts; **Kotlin Compose scan** (`Color(0x…)`, named colours, `.sp`, `.dp` in padding / spacedBy / shapes / borders, raw Material controls); each finding names file:line and **the token to use** (`→ use var(--fx-dens-gap-lg)`, `12.dp → Axf.space.x(1.5)`); allowlist = definition files; frozen code ratchet |
| `framework/spec/conform-baseline.json` (new) | — | frozen code only: 39 Android Kotlin files (286 findings, Android on hold) + `apps/patches-web/src/patches.css` (14, Patches paused). Fails if any file grows; `--update-baseline` shrinks it after a fix; generated Kotlin (templates) never gets an entry |
| `framework/cli/check-controls.mjs` | plugins + libraries | + framework React views, every app's `src`, app templates, library templates (baked `src/axf` and the control definitions in `framework/react/{components,windows}` exempt; Patches paused) |
| `framework/cli/scale-adopt.mjs` | em/px font sizes and spacing | + rem, 1px hairlines → `--fx-border-w`, border widths → `calc(var(--fx-border-w) * n)`, radii → `--fx-radius-{sm,md,lg}`, font stacks → `--fx-font` / `--fx-font-mono`, JSX numbers (`padding: 8`) |
| `framework/cli/build-engine.mjs` | `axf init` validated assets only | `assetConformance()` runs check-theme on the generated app and **refuses to finish** on any finding (all 4 templates + 16 boilerplates pass) |
| Briefs | — | orchestrator brief (`orchestrator-core.mjs` `ASSET_RULE`, "Look:" line) and Build manager launch brief (`orchestrate.mjs`) carry the rule; Build manager verify always runs theme + controls checks |
| CI (`.github/workflows/android.yml`) | theme + controls steps | renamed to asset conformance + new `framework/spec/check-conform.mjs` self-test (16 checks: bad CSS/TSX/Kotlin fail with file:line + token, adopted code passes, baseline holds only frozen code) |

## Violations fixed (what broke hot swapping → what it uses now)

| File | Broke swapping because | Uses now |
|---|---|---|
| `framework/ui/axf.css` (15 lines) | 1px/2px/3px hairlines in padding / gap / margin, px radii (`2px`, `3px`, `calc(radius ± px)`), `0.35em` padding, `-2px` margin, keyframe `opacity: 0.85` | `--fx-border-w` (× n), `--fx-radius-sm`, `--fx-dens-gap-*`, `calc(1 - var(--fx-opacity-tint))` |
| `framework/react/studio/AssetPreview.tsx` (~45 lines) | JSX numbers for padding / gap / radius / font size, `'1px solid'` borders, fixed opacities (0.5–0.85), `22px` grid columns | `--fx-dens-gap-*`, `--fx-type-root-*`, `--fx-radius-*`, `--fx-border-w`, `--fx-opacity-glass` / `-muted`, `--fx-size-icon-button-size` (previewed asset colours still come from that asset) |
| `framework/templates/{react-ts,next-ts,web-fastapi-wall}/src/views/{Home,Components}.tsx` | `1px`/`2px` borders, home slot buttons were raw `<button>` | `--fx-border-w`; `data-fx-row` (whole tappable card) |
| `apps/demo/src/views/{Home,Components}.tsx` (28 findings) | older template copy: fixed `55% / 50% / 40%` transparency in gradients, literal sizes, raw buttons | same as the templates (`calc(var(--fx-opacity-muted) * n%)`, scale tokens, `data-fx-row`) |
| `apps/console-web/src/views/Pending.tsx` | sort pills and status buttons were own-styled raw buttons | `fx-chip` (+ `is-on`), status → `fx-chip--warning/success/danger/accent`; count tiles `data-fx-row` |
| `apps/console-web/src/views/Standards.tsx` + `console.css` | own segmented control `.st-seg__b` with its own chrome, raw remove button | framework `fx-seg fx-seg--sm` / `fx-seg__opt is-on`, `fx-iconbtn`; `.st-seg__b` CSS removed |
| `apps/console-web/src/views/{Plan,LibraryTemplates,BuildManager}.tsx`, `changeBatch.tsx`, `commandText.tsx`, `framework/react/studio/AccountView.tsx` | raw `<button>` rows / cards / toggles / links | `data-fx-row` for whole tappable rows/cards; snapshot links → `fx-chip` |
| plugin CSS (`activity`, `codebase-changes`, `approvals-banner`) | literal `ui-monospace, SFMono-Regular, Menlo, monospace` font stacks | `var(--fx-font-mono)` |
| `console.css` (`.cx-phone`, `.bm-drop`, `.pl-note`) | `6px` / `2px` borders | `calc(var(--fx-border-w) * n)` |
| baked copies (`apps/{console-web,demo,axhub-web,amberx-droid,walkthrough-studio}/src/axf`) | stale after the framework fixes | re-baked (`rebake.mjs apply`) |
| `apps/console-web/plugins/plan-studio/web/voice.ts` | (not a look issue) TS2532 on main broke the console build | `who.charAt(0)` |

## Not fixed (and why)

- **Android Kotlin, 286 findings in 39 files** (axf-ui 178, console app 56, axf-devtools 34, libs 18): all Android work is on hold (rule Oct 21 2026) and this host has no JDK to compile a fix. They are listed by `node framework/cli/check-theme.mjs framework/android apps/console` with the `Axf.*` replacement for each; the baseline stops new ones. Generated Kotlin (templates, library templates) is clean and has no baseline.
- **Patches web, 14 findings** in `apps/patches-web/src/patches.css`: Patches is paused (Oct 28 2026). Baselined.
- Layout-sized values (widths, heights, icon sizes, `999px` pills, `%` shapes) stay literal, as before; `theme-ok` / `scale-ok` comments still mark deliberate exceptions.

## Tests (local, this host)

- Engine job: validate, tracker (repo data), plugins, project manifests, fixtures, catalog, axf-server, build steps, profiles, feature matrix, orch-sync, pending/queue steps, github, libraries, **theme ✓ (784 files), controls ✓, check-conform ✓ 16**, plugin pages, session-checkin, project-wizard, add-ons, plugin lifecycle (all plugins, clean checkout): all pass.
- Init sweep: 4 templates + 16 boilerplates (with the new gate), next-ts build, FastAPI wall build + server self-test (29), library install, UI import, validate: pass.
- Console job: console-web (with ci-example plugin), axhub-web, amberx-droid, walkthrough-studio builds; **theme swap (Playwright): every colour, transparency and size follows**; interface scope (7); 39 TS spec checks; plugin test.mts/test.mjs; Python (framework, server, every plugin test.py, in the console container): pass.
- Not runnable here: Gradle (kernel tests, Android builds); no Kotlin was edited.
- Build manager / orchestrator self-tests: 128 + 19 (new: briefs carry the rule, verify runs both checks).

Environment notes: on this VPS `tracker --check` must run with `AXF_DATA_DIR=off` (the hub's data differs from the repo snapshot), session-checkin's test needs the headless `CLAUDE_CODE_ENTRYPOINT` unset, and the lifecycle check trips on files the session-start sync drops into a worktree (`sessions/archive`, `apps/*/_claude/shared`); none of these happen in CI.

## Push

`git push origin HEAD:main` and `git push origin HEAD:claude/asset-conform` both failed: this VPS has no GitHub
credentials ("Invalid username or token"). The work is committed on `claude/asset-conform` in
`/root/axf-builds/asset-conform`, and a console banner item (`blocked:push:asset-conform`) says how to push it. The brief
asked for a direct push to main, but Brett's Oct 30 rule is that every change goes through a PR. Pushing the branch and
letting the push banner open the PR satisfies both.
