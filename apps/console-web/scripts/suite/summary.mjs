#!/usr/bin/env node
/**
 * Before/after summary of the console suite and the server load test, as Markdown tables for the build report.
 *
 *   node scripts/suite/summary.mjs [--out /tmp/axf-suite/out] [--labels before,after]
 *
 * Reads <out>/<label>/results.json (console-suite.e2e.mjs) and <out>/server-load-<label>.json (server-load.mjs).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', '/tmp/axf-suite/out');
const LABELS = opt('labels', 'before,after').split(',');
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const suites = LABELS.map((l) => read(join(OUT, l, 'results.json')));
const loads = LABELS.map((l) => read(join(OUT, `server-load-${l}.json`)));
const row = (cells) => `| ${cells.join(' | ')} |`;
const head = (cols) => `${row(cols)}\n${row(cols.map(() => '---'))}`;
const lines = [];

// checks per section
const sections = ['startup', 'screens', 'tabs', 'settings', 'dialogs', 'commands', 'slowshot'];
lines.push('### Browser suite: checks passed per section', '', head(['section', ...LABELS]));
for (const s of sections) {
  lines.push(row([s, ...suites.map((r) => { if (!r) return '—'; const c = r.checks.filter((x) => x.section === s); return c.length ? `${c.filter((x) => x.ok).length}/${c.length}` : '—'; })]));
}
lines.push(row(['**total**', ...suites.map((r) => (r ? `**${r.summary.passed}/${r.summary.checks}**` : '—'))]), '');

// startup numbers
lines.push('### Startup and refresh (median of cold load + 3 reloads)', '', head(['measure', ...LABELS]));
const med = (xs) => { const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const st = (r, k) => (r?.sections?.startup ? med(r.sections.startup.map((x) => x[k])) : undefined);
for (const [k, label, unit] of [['firstPaintMs', 'first paint', ' ms'], ['readyMs', 'console ready (control executor answers)', ' ms'], ['settleMs', 'settled (no call in flight for 1 s)', ' ms'], ['calls10s', '/api calls in the first 10 s', ''], ['peakAtOnce', '/api calls in flight at once (peak)', ''], ['openStreams', 'streams held open', '']]) {
  lines.push(row([label, ...suites.map((r) => { const v = st(r, k); return v === undefined ? '—' : v === null ? 'never (30 s)' : `${v}${unit}`; })]));
}
lines.push(row(['calls still unanswered at 10 s (worst run)', ...suites.map((r) => (r?.sections?.startup ? String(Math.max(...r.sections.startup.map((x) => x.pendingAt10s?.length ?? 0))) : '—'))]), '');

// screenshot timing
lines.push('### console_screenshot over the relay', '', head(['measure', ...LABELS]));
lines.push(row(['ten in a row: answered with an image', ...suites.map((r) => { const t = r?.sections?.screenshotTimes; return t ? `${t.filter((x) => x >= 0).length}/10` : '—'; })]));
lines.push(row(['ten in a row: median ms', ...suites.map((r) => { const t = r?.sections?.screenshotTimes?.filter((x) => x >= 0); return t?.length ? String(med(t)) : '—'; })]), '');

// server load
lines.push('### Server load (sandboxed server, CPU in % of one core)', '', head(['phase', ...LABELS.flatMap((l) => [`${l} CPU`, `${l} processes/min`])]));
const phases = [...new Set(loads.flatMap((r) => r?.phases?.map((p) => p.phase) ?? []))];
for (const p of phases) {
  lines.push(row([p, ...loads.flatMap((r) => { const x = r?.phases?.find((y) => y.phase === p); return x ? [`${x.cpuPct} % (peak ${x.peakWindowCpuPct})`, String(x.spawnsPerMin ?? '—')] : ['—', '—']; })]));
}
const burstOf = (r) => r?.phases?.find((p) => p.burst)?.burst;
lines.push(row(['burst p50 / p95 / max ms', ...loads.flatMap((r) => { const b = burstOf(r); return b ? [`${b.p50} / ${b.p95} / ${b.max}`, `${b.errors5xx.length} 5xx · ${b.timeouts.length} timeouts`] : ['—', '—']; })]), '');

// failures
LABELS.forEach((l, i) => {
  const r = suites[i];
  if (!r) return;
  const f = r.checks.filter((c) => !c.ok);
  lines.push(`### Failed checks (${l}): ${f.length}`, '');
  const bySection = {};
  for (const c of f) (bySection[c.section] ??= []).push(c);
  for (const [s, cs] of Object.entries(bySection)) {
    lines.push(`- **${s}** (${cs.length})`);
    for (const c of cs.slice(0, 25)) lines.push(`  - ${c.name}${c.detail ? `: ${c.detail.slice(0, 200).replace(/\|/g, '/')}` : ''}`);
    if (cs.length > 25) lines.push(`  - … ${cs.length - 25} more in results.json`);
  }
  if (loads[i]?.failures?.length) { lines.push(`- **server load** (${loads[i].failures.length})`); for (const x of loads[i].failures) lines.push(`  - ${x.replace(/\|/g, '/')}`); }
  lines.push('');
});
console.log(lines.join('\n'));
