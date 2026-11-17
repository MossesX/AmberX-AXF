/**
 * escalate — what the auto-lander does once a build has failed maxAttempts times (auto-lander@1 `escalate`).
 *
 * Brett, Oct 30 2026: "You need to make sure things like that go into one of the banners. I need to see that kind of
 * shit." Two things happen, once per escalation:
 *
 *   1. the escalation is recorded in <data>/auto-lander/escalations.json (what broke, which kind, how many attempts,
 *      since when, the last attempt's log). The gate plugin's systems-check item (`gate-auto-lander`, health@1,
 *      apps/console-web/plugins/gate/server/auto_lander_health.py) reads it through `auto-lander.mjs status` and shows  // axf-plugin:gate
 *      a red banner item with "Reset and fix now" (`auto-lander.mjs fix <build>`: attempts reset, a fix session starts).
 *   2. one phone push: a console alert through the alert hub, which asks axf.notify@1 before it sends. Type
 *      `gate.auto-lander-escalated` in the gate plugin's notify.json (key gate:auto-lander-escalated:<build>). The
 *      console may be down when it happens: the push stays pending and every tick tries it again (flush) until it is
 *      delivered, never twice. The alert resolves when the build lands or a hand resets it.
 *
 * The console is reached the way the landing line reaches it from the host (docker exec into the console container,
 * its own token; land.mjs makeConsole). AXF_LAND_CONSOLE=off = no console calls (tests).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as attempts from './attempts.mjs';

export const ALERT_PREFIX = 'gate:auto-lander-escalated:';
export const NOTIFY_TYPE = 'gate.auto-lander-escalated';
const file = () => join(attempts.dataDir(), 'escalations.json');
const read = () => { try { const j = JSON.parse(readFileSync(file(), 'utf8')); return j && typeof j.items === 'object' ? j : { items: {} }; } catch { return { $axf: 'auto-lander-escalations@1', items: {} }; } };
const write = (j) => { mkdirSync(dirname(file()), { recursive: true }); const t = `${file()}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify({ $axf: 'auto-lander-escalations@1', ...j }, null, 1)}\n`); renameSync(t, file()); };

let consoleApi = null;
async function api() {
  if (consoleApi) return consoleApi;
  const land = await import('../../apps/console-web/plugins/push-banner/land/land.mjs');  // axf-plugin:push-banner
  consoleApi = land.makeConsole(land.settings());
  return consoleApi;
}
/** Tests: replace the console client ((method, path, body) → answer | null). */
export const setConsole = (fn) => { consoleApi = fn; };

const KIND_WORD = { clash: 'merging main in', 'red-ci': 'fixing red CI', land: 'landing' };

/** The alert for one escalation (console alert hub shape). */
export function alertFor(e) {
  const since = String(e.since || e.at || '').replace('T', ' ').slice(0, 16);
  const body = [`${KIND_WORD[e.kind] || e.kind} failed ${e.attempts} time${e.attempts === 1 ? '' : 's'}${since ? ` since ${since} UTC` : ''}.`, e.why, e.log ? `Last attempt: ${String(e.log).split('\n').filter(Boolean).slice(-3).join(' · ')}` : '', 'Open Gate → Auto-lander, or the systems check banner, and press Fix.'].filter(Boolean).join('\n');
  return { source: 'gate', severity: 'error', key: `${ALERT_PREFIX}${e.build}`, type: NOTIFY_TYPE, title: `Auto-lander gave up on ${e.title || e.build}`.slice(0, 200), body: body.slice(0, 2000), link: `view:gate/tab:gate.tabs=auto-lander/row:${e.build}`, meta: { build: e.build, pr: e.pr || 0, kind: e.kind } };
}

/** Record an escalation and push it once. Returns { ok, pushed, why? }. */
export async function escalate({ build, title = '', kind, attempts: n = 0, why = '', since = '', log = '', pr = 0, push = true, banner = true, at = new Date().toISOString() } = {}) {
  const j = read();
  const prev = j.items[build];
  const rec = { build, title, kind, attempts: n, why, since: since || at, at: prev?.at || at, log: String(log || '').slice(-2000), pr, banner, push, pushedAt: prev?.pushedAt || '' };
  j.items[build] = rec; write(j);
  return push ? flush({ only: build }) : { ok: true, pushed: false };
}

/** Send every pending push (the console may have been down). */
export async function flush({ only = '' } = {}) {
  const j = read(); let pushed = 0; let failed = 0;
  for (const e of Object.values(j.items)) {
    if ((only && e.build !== only) || !e.push || e.pushedAt) continue;
    const r = await (await api())('POST', '/api/alerts', alertFor(e)).catch(() => null);
    if (r) { e.pushedAt = new Date().toISOString(); pushed += 1; } else failed += 1;
  }
  if (pushed) write(j);
  return { ok: !failed, pushed: pushed > 0, ...(failed ? { why: 'the console did not answer; the push is sent on a later tick' } : {}) };
}

/** The escalation is over (landed or reset by hand): the record goes and the phone alert resolves. */
export async function resolve({ build } = {}) {
  const j = read();
  if (!j.items[build]) return { ok: true, resolved: false };
  delete j.items[build]; write(j);
  await (await api())('POST', '/api/alerts/resolve', { keys: [`${ALERT_PREFIX}${build}`] }).catch(() => null);
  return { ok: true, resolved: true };
}

/** Every open escalation. */
export const list = () => Object.values(read().items);
