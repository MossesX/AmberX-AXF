/**
 * Merge review rules (build merge-review-one-by-one-every-built-but-unmerged, Brett Nov 11 2026: "I gotta make sure
 * nothing that's built or that I've written gets overwritten or broken from one of those old branches. Go one by one
 * and I'll tell you to merge it or not."). Pure functions, no I/O: merge-review.mjs does git, files and the console.
 *
 * The review walks every build in status `built`, oldest first. For each one the runner measures, against current
 * main: what the branch changes, which of those files main also changed since the branch forked (the overlap), the
 * lines main added there that the merged result would lose (overwritten or reverted newer code), the files git cannot
 * merge, whether its patches are already on main, and the PR's CI. One build at a time is presented to Brett (console
 * alert + AmberX push) with three answers: merge, skip (archive) or rebuild on current main. Nothing merges without
 * his yes, and while the review runs every reviewed PR is held out of the merge queue.
 */

export const FRAME = 'merge-review@1';
export const DECISIONS = ['merge', 'skip', 'rebuild'];
export const ALERT_SOURCE = 'merge-review';
export const alertKey = (id) => `merge-review:${id}`;
export const HOLD_WHY = 'Merge review: waiting for Brett (merge, skip or rebuild)';

/** Paths the landing tools merge by rule (newer-wins store files, unioned logs): never a risk of losing Brett's work. */
const BOOKKEEPING = [/^_claude\/builds\//, /^_claude\/THREADS\.md$/, /^_claude\/memory\/STATUS\.md$/, /\.log$/, /\.jsonl$/, /^framework\/catalog\/status\.json$/];
export const isBookkeeping = (f) => BOOKKEEPING.some((r) => r.test(f));
/** Generated files the landing tools regenerate after a merge: a conflict there is not lost work. */
const GENERATED = [/(^|\/)axf\.lock\.json$/];
export const isGenerated = (f) => GENERATED.some((r) => r.test(f));

const time = (b) => Date.parse(b.builtAt || '') || Date.parse(b.updatedAt || '') || Date.parse(b.createdAt || '') || 0;

/** The builds to review: status built, not deleted, oldest first (built time, then created). One entry per branch. */
export function candidates(store) {
  const all = (store?.builds || []).filter((b) => b && !b.deleted && b.status === 'built');
  all.sort((a, b) => time(a) - time(b) || String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  const seen = new Set();
  return all.filter((b) => { const k = b.branch || b.id; if (seen.has(k)) return false; seen.add(k); return true; });
}

export const prNumber = (pr) => { const n = Number(String(pr || '').replace(/^#/, '').replace(/.*\/pull\//, '')); return Number.isInteger(n) && n > 0 ? n : 0; };

/** Lines worth comparing (skip blanks and lone braces): a moved bracket is not lost work. */
export const meaningful = (line) => { const t = String(line).trim(); return t.length > 3 && !/^[\])}{(,;]+$/.test(t); };

/** Lines main added (from a `git diff -U0` text) that the merged file no longer has. */
export function lostLines(mainDiff, mergedText) {
  const have = new Set(String(mergedText || '').split('\n').map((x) => x.trim()));
  const added = String(mainDiff || '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
  return added.filter(meaningful).filter((l) => !have.has(l.trim()));
}

/**
 * The verdict for one analysed build: the risk level and a one-line recommendation (Brett decides; this only ranks).
 *   gone     branch missing (nothing to merge);
 *   landed   its PR merged, or every patch already on main (nothing new);
 *   closed   its PR was closed without merging;
 *   conflict git cannot merge it with main;
 *   reverts  the merge would drop lines main added since the branch forked;
 *   overlap  touches files main changed since (merges cleanly, check the feature);
 *   clean    only files main has not touched since.
 */
export function verdict(a) {
  if (a.missing) return { risk: 'gone', advice: 'skip', why: 'Branch not found: nothing to merge.' };
  if (a.prState === 'merged') return { risk: 'landed', advice: 'skip', why: 'Its PR is already merged.' };
  if (!a.unique) return { risk: 'landed', advice: 'skip', why: 'Every change is already on main.' };
  if (a.prState === 'closed') return { risk: 'closed', advice: 'skip', why: 'Its PR was closed without merging (superseded or dropped).' };
  if ((a.conflicts || []).length) return { risk: 'conflict', advice: 'rebuild', why: `${a.conflicts.length} file(s) conflict with main: ${a.conflicts.slice(0, 4).join(', ')}.` };
  const lost = (a.reverts || []).filter((r) => r.lines > 0);
  if (lost.length) return { risk: 'reverts', advice: 'rebuild', why: `Would drop ${lost.reduce((s, r) => s + r.lines, 0)} newer line(s) in ${lost.map((r) => r.file).slice(0, 4).join(', ')}.` };
  if (a.test && a.test.ok === false && !a.test.skipped) { const m = /light check failed: (.+)$/m.exec(a.test.tail || ''); return { risk: 'red', advice: 'rebuild', why: `Merges cleanly but fails current main's checks${m ? ` (${m[1].trim().slice(0, 80)})` : ''}.` }; }
  if (a.ci === 'failure') return { risk: 'red', advice: 'rebuild', why: 'Merges cleanly but its CI is red.' };
  if ((a.overlap || []).length) return { risk: 'overlap', advice: 'merge', why: `Merges cleanly; ${a.overlap.length} file(s) also changed on main since (${a.overlap.slice(0, 3).join(', ')}).` };
  return { risk: 'clean', advice: 'merge', why: 'Merges cleanly; main has not touched its files since.' };
}

/** The next build to present: the oldest one analysed and not yet decided. */
export function next(state) {
  return (state?.items || []).find((x) => !x.decision) || null;
}

/** One line per fact, phone-readable: what Brett reads on the card and the AmberX push. */
export function card(item, { index = 0, total = 0 } = {}) {
  const a = item.analysis || {};
  const v = item.verdict || verdict(a);
  const lines = [
    `${index && total ? `${index}/${total} · ` : ''}${item.title || item.id}${item.pr ? ` (PR ${item.pr})` : ''}`,
    `Built ${String(item.builtAt || '').slice(0, 10) || '?'} · ${a.ahead ?? '?'} commit(s), ${a.codeFiles?.length ?? 0} code file(s) changed`,
    v.why,
  ];
  if (a.reverts?.length) lines.push(`Would overwrite: ${a.reverts.filter((r) => r.lines).map((r) => `${r.file} (${r.lines} line${r.lines === 1 ? '' : 's'})`).slice(0, 5).join(', ') || 'nothing'}`);
  if (a.newer?.length) lines.push(`Newer work on those files: ${a.newer.slice(0, 3).join(' | ')}`);
  if (a.ci || a.test || a.prState) lines.push(`PR ${a.prState || '?'} · CI ${a.ci || '?'}${a.test ? ` · test on main: ${a.test.ok ? 'green' : 'red'}` : ''}`);
  lines.push(`Advice: ${v.advice}. Answer: merge / skip / rebuild.`);
  return lines.join('\n');
}

export function alertFor(item, pos) {
  const v = item.verdict || verdict(item.analysis || {});
  const sev = v.risk === 'conflict' || v.risk === 'reverts' || v.risk === 'red' ? 'warning' : 'info';
  return {
    source: ALERT_SOURCE, key: alertKey(item.id), severity: sev,
    title: `Merge review ${pos.index}/${pos.total}: ${item.title || item.id}`.slice(0, 200),
    body: card(item, pos).slice(0, 1500),
    link: 'view:builds', meta: { build: item.id, pr: item.pr || '', risk: v.risk, advice: v.advice },
  };
}

/** Record Brett's answer. Throws on a bad answer or an unknown build. */
export function decide(state, id, decision, { by = '', why = '', at = new Date().toISOString() } = {}) {
  if (!DECISIONS.includes(decision)) throw new Error(`answer is one of ${DECISIONS.join(', ')}`);
  const items = [...(state?.items || [])];
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no build ${id} in the merge review`);
  items[i] = { ...items[i], decision, decidedBy: String(by).slice(0, 120), decidedAt: at, decisionWhy: String(why).slice(0, 400) };
  return { ...state, items };
}

/** Counts for the summary line. */
export function summary(state) {
  const items = state?.items || [];
  const by = (k) => items.filter((x) => x.decision === k).length;
  const risk = {};
  for (const x of items) { const r = x.verdict?.risk || 'unknown'; risk[r] = (risk[r] || 0) + 1; }
  return { total: items.length, decided: items.filter((x) => x.decision).length, merge: by('merge'), skip: by('skip'), rebuild: by('rebuild'), risk };
}
