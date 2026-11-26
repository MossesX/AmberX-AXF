#!/usr/bin/env node
/**
 * Build rules migration: the builder-rule inventory → the seed store (build-rules@1, framework/spec/BUILD-RULES.md).
 * Build build-rules-tab-gate-rules-vps-owns (Brett, Nov 15 2026: "put them all in that plugin").
 *
 *   node framework/cli/build-rules-migrate.mjs                 write _claude/builds/build-rules/seed.json from the inventory
 *   node framework/cli/build-rules-migrate.mjs --check         fail when any inventory rule is missing from the seed (and from the live store when one exists)
 *   node framework/cli/build-rules-migrate.mjs --live          seed the live store (the engine's store folder: on the VPS
 *                                                              /projects/amberx-axf/_data/build-rules, data.shared `build-rules/`)
 *                                                              from the seed, once: an existing live store is never overwritten
 *   node framework/cli/build-rules-migrate.mjs --inventory <p> --out <p> --at <iso>
 *
 * Every inventoried rule is kept (none dropped): id, title, doer, kind and applies as inventoried, every source verbatim;
 * phase, brief block, check, autofix and brief conditions come from SEED_DEFAULTS below (the Build rules tab changes them
 * later). Rule #1 is `home-card`: every plugin gets a home card, made by the VPS (doer vps, phase after, autofix home-card).
 * `migrate()` is pure, so framework/spec/check-build-rules.mjs replays it.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as B from '../core/build-rules.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const INVENTORY_REL = '_claude/builds/reports/build-rules-tab-gate-rules-vps-owns/inventory.json';

/** Rule #1. Not in any brief: the VPS does it. */
export const HOME_CARD_RULE = Object.freeze({
  id: 'home-card', title: 'Every plugin gets a home card, made by the VPS',
  text: "Every plugin gets a home card. The VPS makes it after the build from the plugin's manifest and data (fixer home-card); a build session never designs or builds one.",
  doer: 'vps', kind: 'mechanical', phase: 'after', enabled: true, check: 'store:home-card', autofix: 'home-card', briefBlock: 'rules', applies: 'builds', when: {},
  sources: [{ source: 'brett:2026-11-15T13:23:46Z', file: '', line: 0, text: "Will the VPS make sure it builds the home card instead of Claude? Remove it from Claude so it doesn't build it twice.", pass: 2 }],
  note: 'Brett, Nov 15 2026. The first rule the VPS owns outright.',
});

/** Rules the VPS owns from the start that no instruction file carried (each has a fixer in the Gate plugin). */
const BRETT = { source: 'brett:2026-11-15T13:23:46Z', file: '', line: 0, text: "Remove everything for all the builders from Claude so it don't happen twice and put them all in that plugin.", pass: 2 };
export const VPS_RULES = Object.freeze([
  { id: 'plugin-help-stub', title: 'Every plugin has its help screen entry, written by the VPS', text: "Every plugin ships help.json with its screen entry (view:<plugin>). The VPS writes a missing one from plugin.json's name and description after the build (fixer help-stub).", doer: 'vps', kind: 'mechanical', phase: 'after', enabled: true, check: 'fixer:help-stub', autofix: 'help-stub', briefBlock: 'rules', applies: 'builds', when: {}, sources: [BRETT] },
  { id: 'api-parity-scaffold', title: 'Every plugin action is on REST, MCP, CLI and voice', text: 'Every command a plugin declares has its REST handler, so MCP and the CLI reach it through plugin-commands, and a plugin with a page registers console actions for voice. The VPS checks it at the gate and scaffolds the missing parts (fixer api-parity).', doer: 'vps', kind: 'mechanical', phase: 'gate', enabled: true, check: 'fixer:api-parity', autofix: 'api-parity', briefBlock: 'rules', applies: 'builds', when: {}, sources: [BRETT] },
  { id: 'ci-checks', title: 'The rule check commands pass before landing', text: "Every enabled rule's check command (check-theme, check-controls, check-toolbars, …) runs on the VPS under the heavy lock before the PR lands (fixer run-ci-checks).", doer: 'vps', kind: 'mechanical', phase: 'gate', enabled: true, check: 'fixer:run-ci-checks', autofix: '', briefBlock: 'rules', applies: 'builds', when: {}, sources: [BRETT] },
  { id: 'done-means-merged', title: 'Done means merged and working; never stop on a failure', text: "Done means merged and working (done-means-merged@1, Nov 17 2026, Brett: \"We asked you to build it. You should do whatever you have to do to build it, period.\"): never stop on a failure. A crash, red CI, a clash, a failed push or a stalled step is something you fix and retry with a different approach, not a reason to end the session: merge main in, fix the failing check, regenerate fixtures, redo the step. Never mark a build built or complete yourself: every step ticked means landing; the server sets landed only once the PR is merged and CI is green on the merge commit, and complete only once the feature verify passed (the builds store refuses anything else). If you truly cannot go on, write a build note saying what broke and what you tried; the server retries on its ladder (retry, fix, fresh session, another model or account) and escalates to the systems check banner and one phone push only when it runs out. Spec: `framework/spec/DONE-MEANS-MERGED.md`; check `node framework/spec/check-done-means-merged.mjs`.", doer: 'session', kind: 'mechanical', phase: 'gate', enabled: true, check: 'node framework/spec/check-done-means-merged.mjs', autofix: '', briefBlock: 'rules', applies: 'builds', when: {}, sources: [{"source": "brett:2026-11-17T00:08:19Z", "file": "", "line": 0, "text": "We asked you to build it. You should do whatever you have to do to build it, period. Why should we say build it and then it fails and you don't say anything and we find out days later?", "pass": 2}], note: "Brett, Nov 17 2026. The VPS enforces it too: the builds store guard (landed / built / complete need the evidence), the dispatcher's failure detector and retry ladder, the auto-lander, the verify runner and the escalation (health@1 + axf.notify@1). Its settings are the retry-policy@1 defaults (framework/core/retry-ladder.mjs)." },
]);

const UI = { when: { ui: true } };
const PLUGIN = { when: { keywords: ['plugin', 'apps/console-web/plugins'] } };
/**
 * Per-rule seed values the inventory does not carry. Missing id = the engine's defaults (session: dispatch + rules block;
 * vps: after), no check, no fixer, no conditions.
 */
export const SEED_DEFAULTS = Object.freeze({
  // the orchestrator's three brief lines keep their blocks and their exact text (orchestrator-core.mjs ASSET_RULE, API_RULE, CHECKPOINT_RULE)
  'ui-asset-tokens': { phase: 'gate', briefBlock: 'look', check: 'node framework/cli/check-theme.mjs', text: 'UI code (handwritten or generated) conforms to the hot-swappable asset system: every colour, size, spacing, font, radius and border comes from asset tokens (--fx-* colour/style, --fx-type-* / --fx-dens-* / --fx-size-* scale, --fx-radius-*, --fx-border-w; Kotlin: Axf.colors / Axf.type / Axf.space / Axf.shapes), framework controls instead of raw ones, no var() fallbacks. `node framework/cli/check-theme.mjs` and `check-controls.mjs` must pass (CI fails otherwise); `node framework/cli/scale-adopt.mjs <path>` moves most literals onto the tokens.' },
  'api-everything': { briefBlock: 'api' },
  'checkpoints': { briefBlock: 'checkpoints', check: 'store:steps-ticked', text: 'Steps are checkpoints inside this ONE session, not separate tasks: work through them in order without stopping between them; when a step is finished, commit it on your branch, push, then tick it done before starting the next (orchestrator.mjs act step <build> <stepId> done; the VPS opens and links the PR). Nothing is lost if the session dies: the next session picks up at the first open step on the same branch. Never ask for a new prompt or a relaunch per step.' },
  'phase-brief-scope': { text: 'Stay in this one session; no sub-agents; keep every step within its cap; read only the files listed; stop at the end of this phase.' },
  'watch-live': { text: 'Watch live: when you start on a screen or element, run `node framework/cli/axf.mjs focus <app> [route] [css-selector] --note "<what you are changing>"` so the live preview follows you.' },
  // session rules the gate verifies (their text still rides in the brief)
  'toolbars': { phase: 'gate', check: 'node framework/cli/check-toolbars.mjs', ...UI },
  'plugin-controls': { phase: 'gate', check: 'node framework/cli/check-controls.mjs', ...UI },
  'themed-transparency': { phase: 'gate', check: 'node framework/cli/check-theme.mjs', ...UI },
  'console-size-tokens': { phase: 'gate', check: 'node framework/cli/check-theme.mjs', ...UI },
  'chrome-assets': { phase: 'gate', check: 'node framework/cli/check-chrome-assets.mjs', ...UI },
  'cross-port-fixtures': { phase: 'gate', check: 'ci:conformance' },
  'change-framework-not-baked': { phase: 'gate', check: 'node framework/cli/rebake.mjs status' },
  'console-control-targets': { phase: 'gate', check: 'node framework/cli/check-console-control.mjs', ...UI },
  'feature-status-tracker': { phase: 'gate', check: 'node framework/cli/tracker.mjs --check' },
  'plugin-lifecycle': { phase: 'gate', check: 'ci:plugin-lifecycle', ...PLUGIN },
  'plugin-settings-subtab': { ...PLUGIN },
  'shared-assets': { phase: 'gate', check: 'node framework/cli/shared-assets.mjs check', ...UI },
  'skins': { phase: 'gate', check: 'npx -y tsx framework/spec/check-skin.mts', ...UI },
  'skin-coverage': { phase: 'gate', check: 'node framework/spec/check-skin-coverage.mjs', when: { keywords: ['skin', 'asset type', 'asset-type'] } },
  'notify-registry': { phase: 'gate', check: 'ci:notify-registry', when: { keywords: ['notif', 'alert', 'push', 'badge'] } },
  'android-on-hold': { phase: 'gate', check: 'ci:no-android-diff', when: { keywords: ['android', 'kotlin', 'droid', 'compose'] } },
  'no-secrets': { phase: 'gate', check: 'ci:secret-scan' },
  'ui-review-options': { phase: 'after', check: 'gate:ui-review', ...UI },
  'shots-not-review': { ...UI },
  'settings-level-toolbar': { ...UI },
  'attached-snap': { ...UI },
  'everything-is-an-asset': { ...UI },
  'embed-one-banner': { ...PLUGIN }, 'banners-settings': { ...PLUGIN }, 'embed-skip': { ...PLUGIN }, 'banners-launch-expanded': { ...UI },
  'editor-sync': { ...PLUGIN }, 'plugin-manager-engine': { ...PLUGIN },
  // vps rules: before dispatch
  'claude-settings-first': { phase: 'before' }, 'models-opus-fable-only': { phase: 'before', check: 'node framework/spec/check-model-policy.mjs' },
  'model-per-step': { phase: 'before' }, 'model-upgrade-approval': { phase: 'before', check: 'watchdog:model-gate' },
  'fable-auto-upgrade': { phase: 'before', check: 'watchdog:model-gate' }, 'build-origin-verbatim': { phase: 'before', check: 'watchdog:build-origin' },
  'small-steps': { phase: 'before', check: 'node framework/spec/check-build-steps.mjs' }, 'build-pipeline': { phase: 'before' }, 'build-profiles': { phase: 'before' },
  'hard-build-limit': { phase: 'before', check: 'store:build-limit' }, 'agent-cap': { phase: 'before', check: 'store:agent-slots' }, 'worker-accounts': { phase: 'before' },
  'one-builds-store': { phase: 'before', check: 'watchdog:verify' }, 'build-priority-tag': { phase: 'before' }, 'load-rules-go-pass': { phase: 'before' },
  'project-manifest': { phase: 'before', check: 'node framework/cli/project.mjs validate --all' }, 'no-fable-rebuilds': { phase: 'before' },
  // vps rules: at dispatch (brief + launch context)
  'rules-brief-only': { phase: 'dispatch' }, 'headless-context': { phase: 'dispatch' }, 'assigned-agent': { phase: 'dispatch' }, 'github-app-tokens': { phase: 'dispatch' },
  'record-every-session': { phase: 'dispatch' }, 'session-in-progress': { phase: 'dispatch' },
  // vps rules: at the gate
  'merge-queue-only': { phase: 'gate', check: 'gate:merge-queue-only' }, 'pr-only': { phase: 'gate', check: 'gate:merge-queue-only' },
  'approve-deny-in-console': { phase: 'gate' }, 'deny-first-screen': { phase: 'gate' },
  // vps rules: after the session / PR
  'ui-review-submit': { phase: 'after', check: 'gate:ui-review', autofix: 'ui-review-submit', ...UI }, 'ui-review-item-schema': { phase: 'after' }, 'shots-group-name': { phase: 'after' },
  'glossary-catalog': { phase: 'after', check: 'store:glossary-catalog', autofix: 'glossary-catalog' }, 'shipped-features': { phase: 'after', check: 'fixer:shipped-features', autofix: 'shipped-features' },
  'builds-live': { phase: 'after', check: 'store:builds-live', autofix: 'pr-open-link' }, 'orchestrator-tracks': { phase: 'after', check: 'store:steps-ticked' },
  'threads-log': { phase: 'after', check: 'fixer:tracker-threads', autofix: 'tracker-threads' }, 'change-log': { phase: 'after' }, 'rebuild-shots': { phase: 'after' }, 'recurring-agents': { phase: 'after' },
  'plugin-built-with': { phase: 'after', ...PLUGIN }, 'app-defaults': { phase: 'after' }, 'carry-on-block': { phase: 'after' }, 'push-via-amberx': { phase: 'after' },
  // narrow rules: only builds that name their subject get them in the brief (keeps the brief within its budget)
  'dns-self': { when: { keywords: ['dns', 'domain', 'cloudflare', 'coolify'] } },
  'kernel-pure-kotlin': { when: { keywords: ['android', 'kotlin', 'kernel'] } },
  'interop-adapters': { when: { keywords: ['kernel', 'interop', 'protocol', 'adapter'] } },
  'hub-badge-red': { when: { keywords: ['badge', 'axhub', 'hub settings'] } },
  'rebuild-report': { when: { keywords: ['rebuild'] } },
  'coolify-apps': { when: { keywords: ['coolify', 'web app', 'deploy', 'new app'] } },
});

/** How good a source is as the rule's own text: the rules-brief bullets first (they are what briefs send today), then quoted constants, then the rules files, then other docs; a code line only when nothing else exists. */
/** A code line that is a whole quoted constant (`export const X = '…';`, `X="…"`), so its prose can be lifted out. */
const CONST_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(['"])([\s\S]*)\1;?\s*$|^\s*\w+=(['"])([\s\S]*)\3\s*(?:#.*)?$/;
function rank(s) {
  if (/rules-briefs\.json$/.test(s.file)) return 0;
  if (/\.(mjs|sh|py)$/.test(s.file)) return CONST_RE.test(s.text) ? 1 : 9;
  if (/(CLAUDE\.md|rules\/RULES\.md|shared\/rules\/RULES\.md)$/.test(s.file)) return 2;
  return 3;
}
/** The prose of one source: markdown bold / comments / list markers, shell comment marks and code quoting stripped. */
export function proseOf(s) {
  let t = String(s.text || '');
  if (/\.(mjs|sh|py)$/.test(s.file)) {
    const m = CONST_RE.exec(t);
    if (m) t = m[2] ?? m[4] ?? t;
    t = t.replace(/\\`/g, '`').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/(^|\s)#\s/g, ' ');
  }
  return t.replace(/<!--.*?-->/g, '').replace(/\*\*/g, '').replace(/^(?:- |## |> )+/, '').replace(/\s+/g, ' ').trim();
}
/** The rule's own text: the best-ranked, then shortest, source. */
export function textFor(entry, override = '') {
  if (override) return String(override).slice(0, B.TEXT_MAX);
  const list = (entry.sources || []).map((s) => ({ s, r: rank(s), t: proseOf(s) })).filter((x) => x.t);
  list.sort((a, b) => a.r - b.r || a.t.length - b.t.length);
  return (list[0] ? list[0].t : String(entry.text || entry.title || '')).slice(0, B.TEXT_MAX);
}

/** One inventory entry → a build-rule@1 (unnormalised; the engine normalises). */
export function ruleFromInventory(e, defaults = SEED_DEFAULTS) {
  const d = defaults[e.id] || {};
  const doer = B.DOERS.includes(e.doer) ? e.doer : 'session';
  return {
    id: e.id, title: String(e.title || e.id).slice(0, B.TITLE_MAX), text: textFor(e, d.text), doer, kind: B.KINDS.includes(e.kind) ? e.kind : 'judgement',
    phase: d.phase || (doer === 'vps' ? 'after' : 'dispatch'), enabled: true, check: d.check || '', autofix: doer === 'vps' ? d.autofix || '' : '', briefBlock: d.briefBlock || 'rules',
    applies: B.APPLIES.includes(e.applies) ? e.applies : 'builds', when: d.when || {},
    sources: (e.sources || []).map((s) => ({ ...s, pass: s.pass || 1 })),
    ...(e.annotated === false ? { note: 'doer and kind are the inventory defaults, not a decision' } : {}),
  };
}

/**
 * The inventory → { store, entry, ids, missing }. Pure. Rule #1 first, then every inventoried rule in inventory order;
 * `missing` is every inventory id the store lacks (always empty here: a dropped rule is a bug).
 */
export function migrate(inventory, { at = new Date().toISOString(), by = 'migration', defaults = SEED_DEFAULTS } = {}) {
  const inv = inventory && typeof inventory === 'object' ? inventory : {};
  const entries = Array.isArray(inv.rules) ? inv.rules : [];
  const own = new Set([HOME_CARD_RULE.id, ...VPS_RULES.map((r) => r.id)]);
  const rules = [HOME_CARD_RULE, ...VPS_RULES, ...entries.filter((e) => e && e.id && !own.has(e.id)).map((e) => ruleFromInventory(e, defaults))];
  const { store, entry } = B.seedStore(rules, { at, by, from: INVENTORY_REL, pass: Number(inv.pass) || 0, action: 'migrate' });
  const ids = new Set(store.rules.map((r) => r.id));
  return { store, entry, ids: [...ids], missing: entries.map((e) => e.id).filter((id) => !ids.has(id)) };
}

/** Inventory ids a store lacks. */
export function missingFrom(inventory, store) {
  const ids = new Set((store?.rules || []).map((r) => r.id));
  return [...new Set([HOME_CARD_RULE.id, ...VPS_RULES.map((r) => r.id), ...((inventory?.rules || []).map((e) => e.id))])].filter((id) => !ids.has(id));
}

// ------------------------------------------------------------------ CLI

function main(argv) {
  const arg = (k, d = '') => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const inventoryPath = arg('--inventory', join(ROOT, INVENTORY_REL));
  const out = arg('--out', B.seedPath(ROOT));
  const at = arg('--at', new Date().toISOString());
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  if (argv.includes('--live')) {
    const dir = arg('--dir', B.storeDir());
    const live = B.load({ dir, seed: out, at });
    if (!live.seeded) { console.log(live.empty ? `no seed at ${out}: run the migration first` : `live store already at ${live.path} (${live.store.rules.length} rules, rev ${live.store.rev}): left as it is`); process.exit(live.empty ? 1 : 0); }
    const { store, entry } = B.seedStore(live.store.rules.map((r) => ({ ...r })), { at: live.store.at, by: 'migration', from: B.SEED_REL, pass: live.store.seededFrom?.pass || 0 });
    B.save(store, [entry], { dir });
    console.log(`seeded the live store ${B.storeFiles(dir).store}: ${store.rules.length} rules`);
    process.exit(0);
  }
  if (argv.includes('--check')) {
    let bad = 0;
    const seed = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
    if (!seed) { console.error(`seed missing: ${out}`); bad += 1; }
    else {
      const errs = B.storeErrors(B.normStore(seed));
      if (errs.length) { console.error(`seed invalid: ${errs.join('; ')}`); bad += 1; }
      const miss = missingFrom(inventory, seed);
      if (miss.length) { console.error(`seed lacks ${miss.length} inventory rule(s): ${miss.join(', ')}`); bad += 1; }
      else console.log(`seed holds every inventory rule: ${seed.rules.length} rules (${inventory.rules.length} inventoried + home-card + ${VPS_RULES.length} VPS-native)`);
    }
    const live = B.load({ at }); // the live store when one exists
    if (!live.seeded && !live.empty) {
      const miss = missingFrom(inventory, live.store);
      if (miss.length) { console.error(`live store ${live.path} lacks ${miss.length} inventory rule(s): ${miss.join(', ')}`); bad += 1; }
      else console.log(`live store holds every inventory rule (${live.store.rules.length} rules, rev ${live.store.rev})`);
    }
    process.exit(bad ? 1 : 0);
  }
  const { store, missing } = migrate(inventory, { at });
  if (missing.length) { console.error(`migration dropped ${missing.length} rule(s): ${missing.join(', ')}`); process.exit(1); }
  const errs = B.storeErrors(store);
  if (errs.length) { console.error(`seed invalid: ${errs.join('; ')}`); process.exit(1); }
  mkdirSync(dirname(out), { recursive: true });
  // axf-data: not data (one-time seed generator: writes the build-rules seed that is committed)
  writeFileSync(out, `${JSON.stringify(store, null, 2)}\n`);
  const n = (f) => store.rules.filter(f).length;
  console.log(`wrote ${out}: ${store.rules.length} rules (vps ${n((r) => r.doer === 'vps')}, session ${n((r) => r.doer === 'session')}; before ${n((r) => r.phase === 'before')}, dispatch ${n((r) => r.phase === 'dispatch')}, after ${n((r) => r.phase === 'after')}, gate ${n((r) => r.phase === 'gate')}; ${n((r) => r.check)} with a check, ${n((r) => r.autofix)} with a fixer)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
