/**
 * Orchestrator demo — the self-test (demo-selftest@1). Build auto-lander-never-wait-missing-ui-review, Nov 18 2026.
 * Brett: "If it recorded the test of the pipeline and didn't merge it on its own, then the test failed. It should have
 * tested itself before it did the demo."
 *
 * Before the demo runs its landing act it runs the REAL lander path on a throwaway PR state (PR 999001 on demo/selftest):
 *   gate-verdict    the live gate rule set (gate-rules@1) evaluated through the gate plugin's own `check_pr`: a green PR
 *                   whose UI Review item is missing lands flagged (ui-review-missing), one whose item waits holds, a
 *                   failed lookup (unknown) never holds
 *   review-lookup   the real lookup of the review item in the live console (GET /api/plugins/ui-review/state) through
 *                   land.mjs lookupReview, and land-core.blockReason on its answer: never a hold
 *   queue-add       the real merge queue rules in check mode (merge-queue-core.notReady with the live queue control
 *                   and config) take the PR, and the lander CLI (land.mjs) is reachable: `queue list` runs
 *   held-prs        the held-prs state (the Land now path) reads
 * The gate, lander and queue modules are found by capability (service:axf.gate@1, service:axf.merge-queue@1), never
 * by folder name. Nothing is written: no branch, no PR, no queue entry. The result is saved (selftest.json) so the
 * systems check item demo-selftest can show it; a failure stops the demo and raises an alert (alertFor).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCHEMA = 'demo-selftest@1';
export const FILE = 'selftest.json';
export const ALERT_KEY = 'orchestrator-demo:selftest';
export const CHECK_ID = 'demo-selftest';
/** The throwaway PR state: a PR number no real PR will carry for years, on a demo/ branch. */
export const PR = 999001;
export const BUILD = 'demo-selftest';
export const BRANCH = 'demo/selftest';
const HEAD = '5e1f7e575e1f7e575e1f7e575e1f7e575e1f7e57';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS = resolve(HERE, '..');

/** The console plugin folder that provides a capability, or null. */
export function providerOf(cap, root = PLUGINS) {
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root).sort()) {
    try { const m = JSON.parse(readFileSync(join(root, d, 'plugin.json'), 'utf8')); if (Array.isArray(m.provides) && m.provides.includes(cap)) return join(root, d); } catch { /* not a plugin */ }
  }
  return null;
}

/** The real modules: the gate (check_pr, held_prs, the lander's files), the landing line's lookup and rules, the queue's rules. */
export async function realDeps() {
  const gateDir = providerOf('service:axf.gate@1');
  const landerDir = providerOf('service:axf.merge-queue@1');
  if (!gateDir) throw new Error('no console plugin provides service:axf.gate@1');
  if (!landerDir) throw new Error('no console plugin provides service:axf.merge-queue@1');
  const gateMod = await import(pathToFileURL(join(gateDir, 'gate.mjs')).href);
  const core = await import(pathToFileURL(join(landerDir, 'land/land-core.mjs')).href);
  const land = await import(pathToFileURL(join(landerDir, 'land/land.mjs')).href);
  const q = await import(pathToFileURL(join(landerDir, 'land/merge-queue-core.mjs')).href);
  const g = gateMod.createGate();
  return {
    gate: (op, input) => g.run(op, input),
    lookupReview: (o) => land.lookupReview(o),
    blockReason: (id, s) => core.blockReason(id, s),
    notReady: (pr, ctl, o) => q.notReady(pr, ctl, o),
    queueControl: () => g.store.queueControl(),
    queueOptions: () => { const c = g.store.landerConfig(); return { waitUi: c.landWaitUi !== false, redJoins: (c.queueMode || 'batch') === 'batch' }; },
    landerCli: () => g.store.landerCli,
    landerCommand: (args) => g.store.landerCommand(args),
  };
}

const snap = (ui) => ({ number: PR, title: 'Orchestrator demo self-test', build: BUILD, branch: BRANCH, head: HEAD, ci: 'success', ui });

/** Run the self-test → demo-selftest@1 { ok, checks: [{ id, title, ok, detail, data? }], durationMs }. Never throws. */
export async function selfTest({ api = async () => null, at = new Date().toISOString(), deps = null } = {}) {
  const t0 = Date.now();
  const checks = [];
  const check = async (id, title, fn) => {
    try { const r = await fn(); checks.push({ id, title, ok: !!r.ok, detail: String(r.detail || '').slice(0, 400), ...(r.data ? { data: r.data } : {}) }); }
    catch (e) { checks.push({ id, title, ok: false, detail: `threw: ${String(e?.message || e)}`.slice(0, 400) }); }
  };
  let d = null;
  try { d = deps || await realDeps(); } catch (e) { checks.push({ id: 'modules', title: 'The gate, lander and queue modules are found by capability', ok: false, detail: String(e.message).slice(0, 400) }); }
  let rv = null;
  if (d) {
    await check('gate-verdict', 'The live gate rules land a green PR whose review item is missing (flagged), hold one whose item waits, and never hold on a failed lookup', async () => {
      const miss = await d.gate('check_pr', { snapshot: snap('missing') });
      const wait = await d.gate('check_pr', { snapshot: snap('waiting') });
      const unk = await d.gate('check_pr', { snapshot: snap('unknown') });
      const ok = !!(miss.ok && miss.pass && miss.flagged && miss.reviewFlag === 'missing' && wait.ok && !wait.pass && wait.held && wait.blockedBy === 'ui-review' && unk.ok && unk.pass && unk.flagged);
      return { ok, detail: ok ? `missing → land, flagged ${miss.flags.join(', ')}; waiting → hold (${wait.blockedBy}); unknown → land, flagged` : `missing: ok=${miss.ok} pass=${miss.pass} flagged=${miss.flagged} ${miss.message || ''}; waiting: held=${wait.held} blockedBy=${wait.blockedBy}; unknown: pass=${unk.pass} flagged=${unk.flagged}`, data: { missing: { pass: miss.pass, flags: miss.flags, reviewFlag: miss.reviewFlag }, waiting: { held: wait.held, blockedBy: wait.blockedBy }, unknown: { pass: unk.pass } } };
    });
    await check('review-lookup', 'The review item is looked up in the live console; no item or no answer is never a hold', async () => {
      rv = await d.lookupReview({ api, branch: BRANCH, pr: PR, claimed: true });
      const block = d.blockReason(BUILD, { ci: 'success', ui: rv.ui });
      const ok = ['missing', 'unknown', ''].includes(rv.ui) && block === null;
      const answered = rv.ui !== 'unknown';
      return { ok, detail: `console ${answered ? `answered: no item for #${PR} (ui ${rv.ui || 'none'}, flag ${rv.reviewFlag || 'none'})` : 'did not answer: unknown = flagged, not a hold'}; blockReason ${block ? `HOLDS: ${block.text}` : 'null: it lands'}`, data: { ui: rv.ui, reviewFlag: rv.reviewFlag, answered } };
    });
    await check('queue-add', 'The merge queue rules take the PR in check mode and the lander CLI answers', async () => {
      const why = d.notReady({ number: PR, head: HEAD, draft: false, fork: false, ci: 'success', ui: rv?.ui || '' }, d.queueControl(), d.queueOptions());
      const cli = d.landerCli();
      const list = cli ? d.landerCommand(['queue', 'list']) : { ok: false, err: 'no lander CLI (no plugin provides service:axf.merge-queue@1 with land/land.mjs)' };
      const ok = why === '' && !!cli && !!list.ok;
      return { ok, detail: `notReady: ${why || 'ready (the queue would take it)'}; lander CLI ${cli ? 'found' : 'missing'}; queue list ${list.ok ? 'answered' : `failed: ${String(list.err || list.out || '').slice(0, 160)}`}`, data: { why, cli: !!cli, queueList: !!list.ok } };
    });
    await check('held-prs', 'The held-prs state (the Land now path) reads', async () => {
      const r = await d.gate('held_prs', {});
      return { ok: !!r.ok, detail: r.ok ? `${r.count} held, ${r.over.length} over ${r.limitMin} min` : String(r.message || 'no answer') };
    });
  }
  return { $axf: SCHEMA, at, ok: checks.length > 0 && checks.every((c) => c.ok), checks, durationMs: Date.now() - t0, pr: PR, branch: BRANCH };
}

/** The systems-check alert for a failed self-test (one key: raised again replaces it; resolved when it passes). */
export function alertFor(r) {
  const bad = (r.checks || []).filter((c) => !c.ok);
  return {
    source: 'orchestrator-demo', key: ALERT_KEY, severity: 'error',
    title: `Orchestrator demo self-test failed: ${bad.map((c) => c.id).join(', ') || 'no checks ran'}`.slice(0, 200),
    body: `${bad.map((c) => `${c.id}: ${c.detail}`).join(' · ')} The demo stopped before its landing act and recorded nothing. Run it again: Systems check → demo-selftest → Run the self-test again (POST /api/plugins/orchestrator-demo/selftest, MCP orchestrator-demo_selftest, axf demo selftest, "run the demo self-test").`.slice(0, 600),
    meta: { check: CHECK_ID },
  };
}

/** Save the result in the plugin data folder (what GET /selftest and the demo-selftest systems check read). */
export function record(files, r) { files.write(FILE, r); return r; }
export const last = (files) => files.read(FILE, null);
