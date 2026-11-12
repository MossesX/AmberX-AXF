#!/usr/bin/env node
/**
 * Registry parity and coverage check (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli, s16).
 * Fails when a UI page, dialog, settings tab, console action or setting has no registry entry, when an entry is not
 * reached on REST, MCP, CLI or voice without a declared reason, when a parameter has no allowed values, when a console
 * target and its deep link disagree, or when the committed index is stale. Findings known when the baseline was written
 * are held (listed, not failing); anything new fails, and a fixed one asks to shrink the baseline.
 *
 *   node scripts/check-registry-coverage.mjs                 check (exit 1 on a new finding or a stale index)
 *   node scripts/check-registry-coverage.mjs --report        also write _claude/builds/registry/gaps.md
 *   node scripts/check-registry-coverage.mjs --baseline      rewrite the baseline to today's findings (after fixing some)
 *   [--json]
 */
import { writeFileSync } from 'node:fs';
import { BASELINE_FILE, REPORT_FILE, compare, findings, readBaseline, report } from '../apps/console-web/lib/registry/coverage.mjs';
import { changes, readIndex } from '../apps/console-web/lib/registry/store.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const index = readIndex();
if (!index) { console.error('✗ no committed index: node apps/console-web/lib/registry/index.mjs build --write'); process.exit(1); }
const ch = changes();
const all = findings(index, { stale: ch.stale ? ch.diff : null });
if (argv.includes('--baseline')) {
  const keys = all.filter((f) => f.kind !== 'stale').map((f) => f.key).sort();
  writeFileSync(BASELINE_FILE, `${JSON.stringify({ $axf: 'registry-coverage-baseline@1', note: 'Coverage findings accepted on the day this was written (scripts/check-registry-coverage.mjs). Shrink it as gaps are fixed; never add to it by hand: declare a gap with its reason instead.', keys }, null, 1)}\n`);
  console.log(`baseline: ${keys.length} findings held → ${BASELINE_FILE}`);
}
const { fresh, fixed, held } = compare(all, readBaseline());
if (argv.includes('--report')) { writeFileSync(REPORT_FILE, report(index, all)); if (!json) console.log(`gap report → ${REPORT_FILE}`); }
if (json) { console.log(JSON.stringify({ ok: !fresh.length, fresh, fixed, held: held.length, entries: index.entries.length })); process.exitCode = fresh.length ? 1 : 0; } else {
for (const f of fresh) console.log(`✗ ${f.why}`);
if (fixed.length) console.log(`! ${fixed.length} held finding(s) are fixed: shrink the baseline (node scripts/check-registry-coverage.mjs --baseline)`);
console.log(fresh.length ? `✗ registry coverage: ${fresh.length} new finding(s) (${held.length} held by the baseline)` : `✓ registry coverage: ${index.entries.length} entries, no new findings (${held.length} held by the baseline${fixed.length ? `, ${fixed.length} fixed` : ''})`);
process.exitCode = fresh.length ? 1 : 0;
}
