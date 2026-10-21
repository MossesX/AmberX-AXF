/**
 * Every agent add-on bundled in this repo passes the framework's add-on contract (CI: npx -y tsx framework/spec/check-addons.mts).
 *
 * Finds `*.addon.json` and `addons/<id>/addon.json` files anywhere in the repo (node_modules, dist, baked copies under
 * `src/axf` and dot-folders skipped) and checks each with `validateAddon` from framework/core/agents.ts (agent-addon@1:
 * tag, id, known sections, item ids), then every item in it with `validateAgentItem` (shape only: references to the
 * host's own tools and agents may point outside the bundle, so they are checked by the host at install). Also lists each add-on's risks (`addonRisks`: env-reading headers,
 * private addresses) so a reviewer sees them in the CI log. Exit 1 on any invalid add-on or a duplicate id.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { addonRisks, AGENT_COLLECTIONS, validateAddon, validateAgentItem, type AgentCollection } from '../core/agents';

const root = new URL('../../', import.meta.url).pathname;
const SKIP = new Set(['node_modules', 'dist', 'dist-single', 'build', '.git', '.gradle']);

function find(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (p.endsWith(join('src', 'axf'))) continue; // baked framework copies inside apps
      find(p, out);
    } else if (name.endsWith('.addon.json') || (name === 'addon.json' && dir.split(/[\\/]/).at(-2) === 'addons')) out.push(p);
  }
  return out;
}

const files = find(root).sort();
let bad = 0;
const seen = new Map<string, string>();
for (const f of files) {
  const rel = relative(root, f);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    console.log(`✗ ${rel}: not JSON (${(e as Error).message})`);
    bad++;
    continue;
  }
  const v = validateAddon(raw);
  if (!v.ok || !v.bundle) {
    console.log(`✗ ${rel}: ${v.errors.join('; ')}`);
    bad++;
    continue;
  }
  const b = v.bundle;
  const errors: string[] = [];
  for (const c of AGENT_COLLECTIONS) {
    for (const item of ((b.provides as Record<string, unknown>)[c] as unknown[] | undefined) ?? []) {
      const r = validateAgentItem(c as AgentCollection, item);
      if (!r.ok) errors.push(`${c}/${String((item as { id?: string }).id)}: ${r.errors.join('; ')}`);
    }
  }
  const prev = seen.get(b.id);
  if (prev) errors.push(`add-on id "${b.id}" is also used by ${prev}`);
  seen.set(b.id, rel);
  if (errors.length) {
    console.log(`✗ ${rel} (${b.id}): ${errors.join(' | ')}`);
    bad++;
    continue;
  }
  const counts = Object.entries(b.provides).filter(([, x]) => Array.isArray(x)).map(([k, x]) => `${(x as unknown[]).length} ${k}`).join(', ');
  const risks = addonRisks(b);
  console.log(`✓ ${rel} (${b.id} ${b.version ?? ''}): ${counts}${risks.length ? `\n    risks: ${risks.join('; ')}` : ''}`);
}
console.log(`${files.length} add-on file(s), ${bad} invalid`);
if (!files.length) console.log('(no add-ons found: nothing to check)');
process.exit(bad ? 1 : 0);
