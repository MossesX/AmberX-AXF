/**
 * Shipped features: how a build step becomes features, and how a later change finds the feature it edits.
 * Pure (no IO). Used by the live hook (build-hook@1 events), the importers and the backfill alike, so a feature
 * planned live and the same feature found later in history land on the same id.
 *
 *   splitStep(step, ctx)        → feature candidates. AI split when ctx.split is given (a function returning
 *                                 [{ name, description, type }]); otherwise the plain fallback: one feature per step.
 *   scopeOf(files, repo)        → { app, plugin, type hint } from the paths a step or PR touches
 *   matchFeature(cand, features, ctx) → the existing feature this candidate changes, or null. AI match when ctx.match is
 *                                 given; plain fallback = same plugin/app scope AND (the same name, or the build / PR
 *                                 text naming the feature, or a strong file overlap).
 */
import * as L from '../../../../../framework/core/feature-ledger.mjs';

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const words = (s) => L.slug(s).split('-').filter((w) => w.length > 2 && !STOP.has(w));
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'add', 'adds', 'new', 'make', 'build', 'step', 'fix', 'fixes', 'update', 'plus', 'every', 'one', 'all', 'that', 'this', 'its', 'when', 'what', 'opus', 'fable']);

/** What app / plugin a set of paths belongs to (the most common one wins). */
export function scopeOf(files = [], repo = 'amberx-axf') {
  if (L.normRepo(repo) === 'axhub') return { app: 'axhub', plugin: '', type: '' };
  const tally = new Map(); let type = '';
  for (const f of files) {
    const p = str(f, 300);
    let m;
    if ((m = p.match(/^apps\/console-web\/plugins\/([^/]+)\//))) tally.set(`console|${m[1]}`, (tally.get(`console|${m[1]}`) || 0) + 3);
    else if ((m = p.match(/^apps\/([^/]+)\//))) { const app = m[1] === 'console-web' ? 'console' : m[1]; tally.set(`${app}|`, (tally.get(`${app}|`) || 0) + 2); }
    else if (/^framework\/(core|schemas|spec|plan)\//.test(p)) { tally.set('framework|', (tally.get('framework|') || 0) + 1); type ||= 'framework-contract'; }
    else if (/^framework\//.test(p)) tally.set('framework|', (tally.get('framework|') || 0) + 1);
    else if (/^(deploy|\.github)\//.test(p)) { tally.set('infra|', (tally.get('infra|') || 0) + 1); type ||= 'infra'; }
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return { app: '', plugin: '', type };
  const [app, plugin] = best[0].split('|');
  return { app: app === 'infra' ? '' : app, plugin, type };
}

export const HOUSEKEEPING = /^\s*(run|check|verify|land|merge|open (the )?pr|pr\b|tick|commit|push|update (the )?(handoff|threads|status)|tests?\b|docs?\b|report\b|readme\b|ui review\b|screenshots?\b|handoff\b|wrap[- ]?up|finish(ing)?\b|polish\b)/i;

/** No paths: a plugin folder named in the text (ui-review, push-banner, …) or a known app gives the scope. */
export function scopeFromText(text, plugins = [], repo = 'amberx-axf') {
  if (L.normRepo(repo) === 'axhub') return { app: 'axhub', plugin: '' };
  const s = ` ${str(text, 6000).toLowerCase()} `;
  const hit = [...plugins].sort((a, b) => b.length - a.length).find((p) => p.length > 3 && new RegExp(`[^a-z0-9-]${p.replace(/[-]/g, '[- ]')}[^a-z0-9-]`).test(s));
  if (hit) return { app: 'console', plugin: hit };
  if (/\bamberx-droid\b|\bamberx (android )?app\b/.test(s)) return { app: 'amberx-droid', plugin: '' };
  if (/\baxhub[- ]web\b/.test(s)) return { app: 'axhub-web', plugin: '' };
  if (/\bconsole\b/.test(s)) return { app: 'console', plugin: '' };
  return { app: '', plugin: '' };
}

/** A short feature name from a step: its title, else the first sentence of its text. */
export function stepName(step) {
  const t = str(step?.title, 200).replace(/^\[(Fable|Opus)\]\s*/, '').replace(/^s\d+[:.)\s-]+/i, '').trim();
  if (t) return t;
  const first = str(step?.text, 2000).replace(/^\[(Fable|Opus)\]\s*/, '').replace(/^s\d+[:.)\s-]+/i, '').split(/(?<=[.!?])\s|\n/)[0].trim();
  return first.length > 120 ? `${first.slice(0, 117).trim()}…` : first;
}
const guessType = (text, hint) => {
  const s = text.toLowerCase();
  if (/\b(remove|retire|delete|kill)\b/.test(s)) return 'removal';
  if (/\b(fix|bug|broken|crash|regression)\b/.test(s)) return 'fix';
  if (/\b(docs?|readme|walkthrough|help text)\b/.test(s) && !/\bui\b/.test(s)) return 'docs';
  if (/\b(tests?|conformance|fixture)\b/.test(s) && !/\b(view|grid|screen)\b/.test(s)) return 'test';
  if (hint) return hint;
  if (/\b(grid|view|screen|page|dialog|button|toolbar|banner|chip|panel|ui)\b/.test(s)) return 'ui';
  return 'new-feature';
};

/**
 * Step → feature candidates. Steps that only check, test, document or land (no feature of their own) give none.
 * ctx: { build: { id, profile, repo, title }, prompt: { id }, at, model, agent, session, split?(step) }
 */
export function splitStep(step, ctx = {}) {
  const text = `${str(step?.title, 200)} ${str(step?.text, 2000)}`.trim();
  if (!text) return [];
  if (HOUSEKEEPING.test(stepName(step))) return []; // build chores (tests, docs, report, UI Review, PR, landing) are not features of their own
  const scope = scopeOf(step?.files || [], ctx.build?.repo);
  if (!scope.plugin && !scope.app) Object.assign(scope, scopeFromText(`${text} ${str(ctx.build?.title)}`, ctx.plugins, ctx.build?.repo), { type: scope.type });
  const parts = typeof ctx.split === 'function' ? (ctx.split(step) || []).filter((p) => str(p?.name).trim()) : [{ name: stepName(step), description: str(step?.text, 2000), type: '' }];
  return parts.map((p) => ({
    name: str(p.name, 300).trim(), description: str(p.description, 4000) || str(step?.text, 2000), type: p.type || guessType(text, scope.type),
    app: p.app || scope.app || (ctx.build?.repo === 'axhub' ? 'axhub' : ''), plugin: p.plugin || scope.plugin, repo: ctx.build?.repo || 'amberx-axf',
    files: step?.files || [], model: str(step?.model) || ctx.model || '', agent: ctx.agent || '', session: ctx.session || '',
    builds: ctx.build?.id ? [{ id: ctx.build.id, profile: ctx.build.profile, role: 'added' }] : [], prompts: ctx.prompt?.id ? [{ id: ctx.prompt.id, passage: '' }] : [],
    plannedAt: ctx.at || '', source: ctx.source || 'live', confidence: typeof ctx.split === 'function' ? 'guessed' : 'exact',
  })).filter((c) => c.name);
}

const jaccard = (a, b) => { const x = new Set(a); const y = new Set(b); if (!x.size || !y.size) return 0; let i = 0; for (const w of x) if (y.has(w)) i += 1; return i / (x.size + y.size - i); };
/** How strongly `text` names a feature: share of the feature name's words found in the text (0..1). */
export function names(text, feature) { const fw = words(feature?.name); if (!fw.length) return 0; const tw = new Set(words(text)); return fw.filter((w) => tw.has(w)).length / fw.length; }

/**
 * The existing feature a candidate changes, or null (a new feature). Never matches a feature of the same build
 * (a build's own steps are its features, not edits of each other), a cancelled one, or across apps/plugins.
 * ctx: { buildId, text (build title + step text + PR title), match?(cand, features) → feature id | null }
 */
export function matchFeature(cand, features, ctx = {}) {
  const pool = (features || []).filter((f) => f && f.status !== 'cancelled' && !f.builds.some((b) => b.id === L.slug(ctx.buildId || '')));
  if (typeof ctx.match === 'function') { const id = ctx.match(cand, pool); return id ? pool.find((f) => f.id === id) || null : null; }
  const same = pool.filter((f) => (cand.plugin ? f.plugin === L.slug(cand.plugin) : f.app === L.slug(cand.app) && !f.plugin) && L.normRepo(f.repo) === L.normRepo(cand.repo));
  if (!cand.plugin && !cand.app) return pool.find((f) => f.id === L.featureId(cand.name, '')) || null; // no scope: only the very same feature
  const byId = same.find((f) => f.id === L.featureId(cand.name, cand.plugin || cand.app)); if (byId) return byId;
  let best = null; let score = 0;
  for (const f of same) {
    const s = Math.max(jaccard(words(cand.name), words(f.name)), names(`${cand.name} ${ctx.text || ''}`, f) * 0.9) + (cand.files?.length && f.files?.length ? jaccard(cand.files, f.files) * 0.3 : 0);
    if (s > score) { score = s; best = f; }
  }
  return score >= 0.6 ? best : null;
}

/** The edit record for a candidate that matched an existing feature. */
export function editFrom(cand, feature, ctx = {}) {
  return {
    feature: feature.id, kind: cand.type === 'removal' ? 'removed' : cand.type === 'fix' ? 'fixed' : 'changed', summary: cand.name === feature.name ? str(cand.description, 300) || cand.name : cand.name,
    build: ctx.build?.id || '', profile: ctx.build?.profile || '', pr: ctx.pr || 0, repo: cand.repo, commit: ctx.commit || '', prompt: ctx.prompt?.id || '',
    model: cand.model, agent: cand.agent, session: cand.session, status: ctx.status || 'planned', at: ctx.at || '', mergedAt: ctx.mergedAt || '', files: cand.files || [],
    source: cand.source || 'live', seq: ctx.seq || 0,
  };
}
