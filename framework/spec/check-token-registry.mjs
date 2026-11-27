#!/usr/bin/env node
/**
 * token-registry@1 (build token-registry-skin-editor-live-sandbox, Brett Nov 13 2026: "list every token in a registry; any
 * time a new UI is made add its tokens to the registry"). Plain node, no build step. Fails on
 *   - a registry document that does not validate (core/engines/token-registry.mjs registryErrors),
 *   - a token the engines, axf.css, the colour themes or a manifest define that the registry does not list (run
 *     `node framework/cli/token-registry.mjs sync --write`),
 *   - a token any UI reads (framework, apps, plugins, libraries) that the registry does not list,
 *   - a registered token nothing reads (a generated scale / layout token or a `deprecated` entry is allowed),
 *   - a plugin outside spec/token-manifest-baseline.json whose plugin.json has no `tokens` block, or whose `tokens.uses`
 *     differs from what its files read (`token-registry.mjs manifest <folder> --write`); the baseline only shrinks,
 * and replays the pure engine's golden fixture (spec/fixtures/token-registry.json: classification, levels, search,
 * manifest errors, coverage, control@1 sets, the snapshot chain, revert, revert-by-time, export + round trip, voice).
 *
 *   node framework/spec/check-token-registry.mjs [--json] [--quiet]
 */
import { readFileSync } from 'node:fs';
import { check, fixture, FIXTURE_FILE, ROOT } from '../cli/token-registry.mjs';
import { relative } from 'node:path';

const json = process.argv.includes('--json');
const quiet = process.argv.includes('--quiet') || json;

const r = check();
const problems = [...r.problems];

let stored = null;
try { stored = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')); } catch { problems.push(`${relative(ROOT, FIXTURE_FILE)} is missing: run node framework/cli/token-registry.mjs fixture --write`); }
if (stored) {
  const fresh = fixture();
  for (const key of Object.keys(fresh)) {
    if (JSON.stringify(fresh[key]) !== JSON.stringify(stored[key])) problems.push(`fixture "${key}" differs from the engine (run node framework/cli/token-registry.mjs fixture --write and review the diff)`);
  }
  // the chain's own invariants, as the Skin editor relies on them
  const { chain, rows, before, exported, roundTrip, voice } = fresh;
  if (chain[0].id !== 'default' || chain[0].parent !== null) problems.push('fixture: the chain does not start at the default skin');
  if (!rows.every((row) => row.onPath) || !rows[rows.length - 1].head) problems.push('fixture: the revert is not the head of a single path');
  if (before.tenMinutesAgo !== chain[3].id) problems.push('fixture: revert-by-time picks the wrong snapshot');
  if (chain[4].kind !== 'revert' || JSON.stringify(chain[4].state) !== JSON.stringify(chain[1].state)) problems.push('fixture: a revert must copy the target state as a new snapshot');
  if (exported.asset.type !== 'skin' || exported.asset.id !== 'midnight-sky' || exported.unmapped.length !== 1) problems.push('fixture: the exported skin is not shaped as expected');
  if (JSON.stringify(roundTrip) !== JSON.stringify({ ...chain[2].state, '--fx-btn-bg-hover': '#333' })) problems.push('fixture: skinState(exportSkin(state)) must give the state back');
  for (const v of voice) if (v.intent === null && !/lights/.test(v.phrase)) problems.push(`fixture: voice phrase not understood: "${v.phrase}"`);
}

if (json) console.log(JSON.stringify({ ok: problems.length === 0, problems, tokens: r.tokens, used: r.used }, null, 2));
else if (problems.length) {
  for (const p of problems) console.log(`✗ ${p}`);
  console.log(`\n${problems.length} token registry problem(s). framework/spec/THEMING.md → Token registry.`);
} else if (!quiet) console.log(`✓ token-registry@1: ${r.tokens} tokens registered, ${r.used} read in the sources, manifests current, fixture current`);
process.exit(problems.length ? 1 : 0);
