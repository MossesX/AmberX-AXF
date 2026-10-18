/**
 * pending — reads and writes framework/plan/pending.json (pending@1) on top of plan/pending-core.mjs.
 *   node framework/cli/pending.mjs                 list (sorted by status)
 *   node framework/cli/pending.mjs --sort added    list sorted by date added (also: built)
 * The console API and MCP server go through engine-rpc ops pending / pending-act.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/pending-core.mjs';
import { dataPath } from './persist.mjs';

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PENDING = dataPath('framework/plan/pending.json');

export function loadPending() { return core.normalizeState(existsSync(PENDING) ? JSON.parse(readFileSync(PENDING, 'utf8')) : core.emptyPending()); }
export function savePending(s) { writeFileSync(PENDING, JSON.stringify(s, null, 1) + '\n'); }

/** Apply one action (see pending-core apply) and save. */
export function actPending(action, now = new Date().toISOString()) {
  const r = core.apply(loadPending(), action, now);
  savePending(r.state);
  return r;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--sort');
  const key = i > 0 ? process.argv[i + 1] : 'status';
  const s = loadPending();
  for (const it of core.sortItems(s.items, key)) {
    const d = core.shownDate(it);
    console.log(`${core.STATUS_LABEL[it.status].padEnd(9)} ${it.model.padEnd(7)} ${d.label} ${d.at.slice(0, 10)}  ${it.title}  (${it.id})`);
  }
  console.log(Object.entries(core.counts(s.items)).map(([k, n]) => `${k} ${n}`).join(' · '));
}
