#!/usr/bin/env node
/**
 * data-fixes — one-off, idempotent fixes to the live shared data (the copy the console reads, through dataPath()).
 * The installer runs this on every update; each fix checks first and only changes what still needs it.
 *
 *   node framework/cli/data-fixes.mjs          apply (prints what changed)
 *   node framework/cli/data-fixes.mjs --check  show what would change
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlan, upsertFeature } from './plan.mjs';

const FRAMEWORK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHECK = process.argv.includes('--check');

// Oct 18 2026: three of Brett's other apps are unrelated to AmberX; their names come out of these titles.
const RENAMES = {
  'dv.a11yservice': 'Accessibility service + overlay/draw-over-apps',
  'c.deploy': 'Deploy wizard from phone to VPS subdomain',
  'c.voice': 'Voice commands + gesture hooks',
  'c.pilot': 'Screen-control demo (accessibility service + overlay)',
};
const OLD = /-style\b/; // the old titles said "<App>-style"

let changed = 0;
const plan = loadPlan();
for (const [id, title] of Object.entries(RENAMES)) {
  const f = plan.features.find((x) => x.id === id);
  if (!f || f.title === title || !OLD.test(f.title)) continue;
  console.log(`${CHECK ? 'would rename' : 'renamed'} ${id}: "${f.title}" → "${title}"`);
  if (!CHECK) upsertFeature({ ...f, title }, 'Renamed: removed an unrelated app name from the title');
  changed += 1;
}
if (changed && !CHECK) {
  // tracker.json is shared data built from the catalog: regenerate it so its titles match.
  try { execFileSync(process.execPath, [join(FRAMEWORK_DIR, 'cli/tracker.mjs')], { stdio: 'pipe' }); console.log('tracker.json regenerated'); } catch (e) { console.log(`tracker regeneration failed: ${e.message}`); }
}
if (!changed) console.log('data fixes: nothing to change');
