/**
 * Gauge + progress meter control assets (engines/components.ts): normalizeGauge / normalizeMeter / gaugeStyle /
 * meterStyle / meterCells / gaugeTicks against spec/fixtures/meters.json, plus every starter asset passes and every
 * enum in asset-types.json is one the engine knows. `npx -y tsx framework/spec/check-meters.mts [--write]`
 * (--write regenerates the fixture's expected values from the reference engine; review the diff).
 * The Kotlin twin is deferred (spec/PORTING.md): the fixture is what it will replay.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gaugeStyle, gaugeTicks, meterCells, meterStyle, normalizeGauge, normalizeMeter } from '../core/engines/components';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures/meters.json');
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
const run = {
  normalizeGauge: (i: unknown) => normalizeGauge(i as never),
  normalizeMeter: (i: unknown) => normalizeMeter(i as never),
  gaugeStyle: (i: unknown) => gaugeStyle(i as never),
  meterStyle: (i: unknown) => meterStyle(i as never),
  meterCells: (i: { p: number; segments: number }) => meterCells(i.p, i.segments),
  gaugeTicks: (i: number) => gaugeTicks(i),
} as Record<string, (i: never) => unknown>;
let ok = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); process.exit(1); };
if (process.argv.includes('--write')) {
  for (const c of fx.cases) c.expected = run[c.fn]!(c.input as never);
  writeFileSync(FIX, `${JSON.stringify(fx, null, 2)}\n`);
  console.log(`wrote ${fx.cases.length} expected values`);
}
for (const c of fx.cases) {
  const got = JSON.stringify(run[c.fn]!(c.input as never));
  if (got !== JSON.stringify(c.expected)) fail(`${c.fn} ${c.name}: got ${got}, want ${JSON.stringify(c.expected)}`);
  ok++;
}
const spec = JSON.parse(readFileSync(join(here, '../schemas/asset-types.json'), 'utf8')).types;
for (const [type, norm] of [['gauge', normalizeGauge], ['meter', normalizeMeter]] as const) {
  for (const f of readdirSync(join(here, '../assets', type))) {
    const a = JSON.parse(readFileSync(join(here, '../assets', type, f), 'utf8'));
    const n = (norm as (d: unknown) => Record<string, unknown>)(a.data);
    for (const k of spec[type].required) if (JSON.stringify(n[k]) !== JSON.stringify(a.data[k])) fail(`${type}/${f}: ${k} = ${JSON.stringify(a.data[k])} is changed by the engine to ${JSON.stringify(n[k])}`);
    ok++;
  }
  for (const [field, values] of Object.entries(spec[type].enums as Record<string, string[]>)) {
    for (const v of values) if ((norm as (d: unknown) => Record<string, unknown>)({ [field]: v })[field] !== v) fail(`${type}.${field} = ${v} is in asset-types.json but the engine drops it`);
    ok++;
  }
}
console.log(`check-meters: ${ok} checks passed`);
