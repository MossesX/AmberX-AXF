/**
 * hub-settings-migration@1 — axHub web's saved settings → the console's hub-console@1 settings. Pure, IO-free; the CLI
 * framework/cli/hub-settings-migrate.mjs reads and writes the documents. Build move-everything-axhub-web-console (s4).
 *
 * Both apps keep their Settings values on the hub as hub-settings@1 documents (lib-hubstore / lib-hubsync):
 * `settings/apps/axhub-web.json` and `settings/apps/axf-console.json` under the shared project's `_data`. axHub web's
 * per-user page preferences are small today (its grid columns, sorts and filters were React state; open rows live in
 * sessionStorage; the look rides the app-look document, not here), so the migration is a rule list over keys:
 *
 *   rule = { match: RegExp source key, to: console key | (m) => key, why, review? }     a key that moves
 *   skip = { match, why }                                                                 a key that stays behind, and why
 *
 * `planMigration(source, target, table)` → one line per source key: `move` (with the value it lands as, after the
 * target setting's kind / options / range are checked), `keep` (the console already has a value for the key; `force`
 * overrides), `skip` (with why), `review` (moved under the generic `axhub-web.<x>` → `axf.hub.<x>` rule: a person
 * should look). `applyMigration` returns the new target document (per-key merge, nothing else touched) and the
 * hub-settings-migration-report@1 the CLI writes once; a second run with the report present is a no-op unless `again`.
 */
import { settingsOf } from './hub-console.mjs';

export const FRAME = 'hub-settings-migration@1';
export const REPORT_FRAME = 'hub-settings-migration-report@1';
export const SETTINGS_FORMAT = 'hub-settings@1';
export const SOURCE_APP = 'axhub-web';
export const TARGET_APP = 'axf-console';
export const BY = 'hub-settings-migrate';
export const OUTCOMES = ['move', 'keep', 'skip', 'review'];

/** Keys that move, in order (the first rule that matches wins). */
export const RULES = [
  { match: /^(axhub-web\.source|axf\.approvals\.source)$/, to: 'axf.hub.approvals.source', why: 'the approvals source filter' },
  { match: /^(axhub-web\.approvals\.grid|axf\.approvals\.grid)$/, to: 'axf.hub.approvals.grid', why: 'the approvals grid columns and sort' },
  { match: /^(axhub-web\.log\.filters|axf\.approvals\.log\.filters)$/, to: 'axf.hub.log.filters', why: 'the approval log filters' },
  { match: /^(axhub-web\.passes\.grant|axf\.passes\.grant)$/, to: 'axf.hub.passes.grant', why: 'the grant-pass form defaults' },
  { match: /^(axhub-web\.poll|axf\.hub\.poll)$/, to: 'axf.hub.poll', why: 'how often the hub is read' },
  { match: /^axf\.hub\.[a-zA-Z0-9.]+$/, to: (m) => m[0], why: 'already a hub-console key' },
  { match: /^axhub-web\.(.+)$/, to: (m) => `axf.hub.${m[1]}`, why: 'an axHub web page preference with no named rule', review: true },
];

/** Keys that stay behind. */
export const SKIPS = [
  { match: /^axf\.hubsync\./, why: 'device-only: the connection is what finds the hub and is never in the document' },
  { match: /^axf\.approvals\.open$/, why: 'session-only: which rows are open lives in sessionStorage per tab' },
  { match: /^axf\.(display|dev|settings|placement|roll|ashes|appearance|chrome|tokens|skins?)\./, why: 'the console keeps its own value for this app-level setting' },
  { match: /^(alerts-bell|plugin-manager)\./, why: 'a console plugin setting the console already holds' },
];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A hub-settings@1 document in shape (unknown → empty). */
export function normDoc(raw, by = '') {
  const d = isObj(raw) ? raw : {};
  return { $axf: SETTINGS_FORMAT, values: isObj(d.values) ? { ...d.values } : {}, updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : '', updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : by };
}

/** The value as the target setting takes it: kind, options and range from the hub-console@1 table; null = refused. */
export function coerce(setting, value) {
  if (!setting) return { ok: true, value };
  switch (setting.kind) {
    case 'toggle': return typeof value === 'boolean' ? { ok: true, value } : value === 'true' || value === 'false' ? { ok: true, value: value === 'true' } : { ok: false, why: 'not a toggle value' };
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      if (!Number.isFinite(n)) return { ok: false, why: 'not a number' };
      if (setting.min !== undefined && n < setting.min) return { ok: false, why: `below ${setting.min}` };
      if (setting.max !== undefined && n > setting.max) return { ok: false, why: `above ${setting.max}` };
      return { ok: true, value: n };
    }
    case 'choice': return typeof value === 'string' && (!Array.isArray(setting.options) || setting.options.includes(value)) ? { ok: true, value } : { ok: false, why: `not one of ${(setting.options ?? []).join(', ')}` };
    case 'text': return typeof value === 'string' ? { ok: true, value } : { ok: false, why: 'not text' };
    case 'json': {
      if (isObj(value)) return isObj(setting.default) ? { ok: true, value: { ...setting.default, ...value } } : { ok: true, value };
      if (typeof value === 'string') { try { const v = JSON.parse(value); return isObj(v) ? coerce(setting, v) : { ok: false, why: 'not an object' }; } catch { return { ok: false, why: 'not JSON' }; } }
      return { ok: false, why: 'not an object' };
    }
    default: return { ok: true, value };
  }
}

/**
 * The plan: one line per source key, `{ key, outcome, to?, value?, from?, why }`, source order. `force` moves a key the
 * console already has a value for (the console's value is in `from`).
 */
export function planMigration(source, target, table, { force = false } = {}) {
  const src = normDoc(source); const tgt = normDoc(target);
  const settings = new Map(settingsOf(table).map((s) => [s.key, s]));
  const lines = [];
  for (const [key, value] of Object.entries(src.values)) {
    const skip = SKIPS.find((s) => s.match.test(key));
    if (skip) { lines.push({ key, outcome: 'skip', why: skip.why }); continue; }
    let to = null; let rule = null;
    for (const r of RULES) { const m = r.match.exec(key); if (m) { rule = r; to = typeof r.to === 'function' ? r.to(m) : r.to; break; } }
    if (!rule) { lines.push({ key, outcome: 'skip', why: 'no rule names it: not a hub page preference' }); continue; }
    const setting = settings.get(to) ?? null;
    if (!setting && !rule.review) { lines.push({ key, outcome: 'skip', to, why: `${to} is not a registered hub-console setting` }); continue; }
    const c = coerce(setting, value);
    if (!c.ok) { lines.push({ key, outcome: 'skip', to, why: `${c.why} for ${to}` }); continue; }
    if (Object.hasOwn(tgt.values, to) && !force) { lines.push({ key, outcome: 'keep', to, from: tgt.values[to], value: c.value, why: 'the console already has a value (use --force to replace it)' }); continue; }
    lines.push({ key, outcome: rule.review ? 'review' : 'move', to, value: c.value, why: rule.why });
  }
  return lines;
}

/** Counts per outcome. */
export const summarize = (lines) => Object.fromEntries(OUTCOMES.map((o) => [o, lines.filter((l) => l.outcome === o).length]));

/**
 * Apply a plan: → `{ target, report }`. Only `move` and `review` lines write; the target keeps every other key. The
 * report is what the CLI stores once so the migration runs once (`already` = a report was given and `again` is false).
 */
export function applyMigration(target, lines, { now = new Date().toISOString(), report: previous = null, again = false, sourceFile = '', targetFile = '' } = {}) {
  if (previous && !again) return { target: normDoc(target), report: previous, already: true };
  const tgt = normDoc(target);
  const written = lines.filter((l) => l.outcome === 'move' || l.outcome === 'review');
  for (const l of written) tgt.values[l.to] = l.value;
  if (written.length) { tgt.updatedAt = now; tgt.updatedBy = BY; }
  const report = { $axf: REPORT_FRAME, at: now, from: SOURCE_APP, to: TARGET_APP, sourceFile, targetFile, counts: summarize(lines), lines };
  return { target: tgt, report, already: false };
}

/** One readable line per plan entry. */
export const describeLine = (l) => `${l.outcome.padEnd(6)} ${l.key}${l.to && l.to !== l.key ? ` → ${l.to}` : ''}${l.outcome === 'move' || l.outcome === 'review' ? ` = ${JSON.stringify(l.value)}` : ''}  (${l.why})`;
