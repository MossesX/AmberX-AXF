#!/usr/bin/env node
/**
 * Orchestrator demo dry run, end to end: node apps/console-web/plugins/orchestrator-demo/test-e2e.mjs [--gap 300] [--pause]
 *
 * Plays the whole act catalog through the real runner.mjs (start → detached driver → done → cleanup) with:
 *   - the test-only clock AXF_DEMO_GAP_MS_TEST (the 30 s gap becomes --gap ms of real time; the core still enforces 30 s
 *     of its own virtual time, so the gap rule is exercised, not bypassed);
 *   - a copy of the real builds store (AXF_BUILDS_STORE), so the acts run against real builds next to the demo ones;
 *   - the fake headless runner (no Claude account) and the dry-run lander (never the merge queue);
 *   - no console (AXF_DEMO_CONSOLE=off: alerts are recorded in the run, no focus calls) and no builds-live publish.
 * With --pause it presses Next on every waiting act, the way Brett would.
 *
 * Passes when every act passes, the cleanup has no errors and removed every demo build, and no non-demo build of the
 * store changed (byte-for-byte per build). Prints the check-list and writes a JSON report with --out <file>.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const GAP = Number(flag('--gap', '300'));
const PAUSE = argv.includes('--pause');
const OUT = flag('--out', '');
const LIMIT_MS = Number(flag('--limit', String(15 * 60 * 1000)));

const tmp = mkdtempSync(join(tmpdir(), 'od-e2e-'));
const store = join(tmp, 'builds.json');
const { storeFile } = await import('../../../../framework/cli/builds-store.mjs');
const source = storeFile();
if (existsSync(source)) copyFileSync(source, store); else writeFileSync(store, JSON.stringify({ $axf: 'builds@1', builds: [] }));
const env = { ...process.env, AXF_PLUGINS_DATA_DIR: join(tmp, 'plugins'), AXF_BUILDS_STORE: store, AXF_BUILDS_LIVE: '0', AXF_DEMO_CONSOLE: 'off', AXF_DEMO_GAP_MS_TEST: String(GAP) };
const runner = (...a) => {
  const r = spawnSync(process.execPath, [join(HERE, 'runner.mjs'), ...a], { env, encoding: 'utf8', cwd: REPO });
  const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '';
  try { return JSON.parse(line); } catch { return { ok: false, error: (r.stderr || r.stdout).slice(-400) }; }
};
// every build that isn't this run's own fixture, by id: real builds named demo-* included
let ours = new Set();
const others = (doc) => new Map((doc.builds ?? []).filter((b) => !ours.has(b.id)).map((b) => [b.id, JSON.stringify(b)]));
const before = others(JSON.parse(readFileSync(store, 'utf8')));
const realDemoNamed = [...before.keys()].filter((id) => id.startsWith('demo-')).length;

const t0 = Date.now();
let fails = [];
try {
  const s = runner('start', PAUSE ? '--pause' : '--no-pause');
  if (!s.ok) throw new Error(`start refused: ${s.error}`);
  const id = s.state.run.id;
  ours = new Set(Object.values(s.state.ids ?? {}));
  for (const k of ours) before.delete(k);
  console.log(`dry run ${id}: ${s.state.run.acts.length} acts, gap ${GAP} ms real (30 s virtual), pause between steps ${PAUSE ? 'on' : 'off'}`);
  let last = '';
  for (;;) {
    if (Date.now() - t0 > LIMIT_MS) { runner('event', 'stop', '--why', 'e2e time limit', '--by', 'driver'); throw new Error(`time limit ${LIMIT_MS} ms`); }
    const st = runner('state').state;
    const cap = st?.caption;
    const line = `${st?.run?.state} ${cap ? `${cap.n}/${cap.of} ${cap.actId}` : ''}`;
    if (line !== last) { process.stdout.write(`  ${line}\n`); last = line; }
    if (st?.run?.state === 'waiting-next') runner('event', 'next');
    if (['done', 'stopped'].includes(st?.run?.state)) {
      const sum = runner('summary');
      if (sum.cleanup) {
        console.log('\nCheck-list:');
        for (const c of sum.checklist) console.log(`  ${c.mark} ${c.title}${c.result === 'fail' ? `  ← ${c.error || c.observed}` : ''}`);
        const notPass = sum.summary.acts.filter((a) => a.result !== 'pass');
        if (st.run.state !== 'done') fails.push(`the run ended ${st.run.state}`);
        for (const a of notPass) fails.push(`act ${a.actId} ${a.result}: ${a.error || a.observed}`);
        if (sum.cleanup.errors.length) fails.push(`cleanup errors: ${sum.cleanup.errors.join('; ')}`);
        const after = JSON.parse(readFileSync(store, 'utf8'));
        // the store never drops a record: a removed fixture stays soft-deleted, which the grids show as gone
        const left = (after.builds ?? []).filter((b) => ours.has(b.id) && !b.deleted).map((b) => b.id);
        if (left.length) fails.push(`demo builds left: ${left.join(', ')}`);
        const now = others(after);
        for (const [bid, doc] of before) if (now.get(bid) !== doc) fails.push(`non-demo build changed: ${bid}`);
        for (const bid of now.keys()) if (!before.has(bid)) fails.push(`non-demo build added: ${bid}`);
        console.log(`\n${sum.summary.pass} passed · ${sum.summary.fail} failed · ${sum.summary.skipped} skipped of ${sum.summary.total} · ${before.size} real builds checked unchanged (${realDemoNamed} of them named demo-*) · ${Math.round((Date.now() - t0) / 1000)} s`);
        if (OUT) writeFileSync(OUT, JSON.stringify({ $axf: 'orchestrator-demo-dry-run@1', at: new Date().toISOString(), gapMs: GAP, pause: PAUSE, seconds: Math.round((Date.now() - t0) / 1000), realBuilds: before.size, realDemoNamed, summary: sum.summary, cleanup: sum.cleanup, fails }, null, 2));
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
} catch (e) {
  fails.push(e.message);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails.length ? `\nFAILED:\n  ${fails.join('\n  ')}` : '\nall acts passed; no non-demo build changed');
process.exitCode = fails.length ? 1 : 0;
