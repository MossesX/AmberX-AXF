/**
 * Cleanup helper rules (pure, no DOM): what the Build profiles cleanup scan found, in the shape the panel shows.
 *
 * The scan itself is the framework's (framework/cli/profiles.mjs `cleanup`, builds-store-core cleanupScan): this
 * plugin only reads it through its own route (GET /api/plugins/build-profiles/cleanup) and asks for the fix
 * (POST the same route). Nothing here decides whether a build is finished.
 *
 * Findings:
 *   archived-complete   an archived build that finished (its PR merged, or every step done). Fixable when the store
 *                       has the proof to move it (`to` = complete / landed); otherwise `why` says what is missing.
 *   orphan-profile      a build tagged with a build profile that no longer exists; the fix moves it to the base one.
 *
 * Self-test: node apps/console-web/plugins/build-profiles/cleanup.test.mjs
 */

export const KINDS = ['archived-complete', 'orphan-profile'];

const KIND_TEXT = {
  'archived-complete': { title: 'Archived, but finished', hint: 'These builds sit in the archive, yet the record says they finished. The fix gives them the status they earned.' },
  'orphan-profile': { title: 'In a profile that no longer exists', hint: 'These builds are tagged with a build profile that is gone. The fix moves them to the base profile.' },
};
const OTHER = { title: 'Other findings', hint: '' };

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');
const list = (v) => (Array.isArray(v) ? v : []);

/** One finding, whatever the scan called its fields. Returns null for anything without a build id. */
export function normalizeFinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 120) || str(raw.build, 120);
  if (!id) return null;
  const kind = str(raw.kind, 40) || 'archived-complete';
  const profiles = list(raw.profiles).map((p) => str(p, 40)).filter(Boolean);
  if (!profiles.length && str(raw.profile, 40)) profiles.push(str(raw.profile, 40));
  const to = str(raw.to, 40);
  const why = str(raw.why);
  // a finding the scan did not mark is fixable unless it explains why it is not
  const fixable = typeof raw.fixable === 'boolean' ? raw.fixable : !!to || !why;
  return { kind, id, title: str(raw.title) || id, profiles, status: str(raw.status, 40) || 'archived', fixable, to, why: fixable ? '' : why, evidence: str(raw.evidence) };
}

/** The scan's answer → { findings, counts, fixable, total }. Unknown shapes come back empty, never throw. */
export function normalizeScan(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const findings = [];
  for (const r of [...list(src.findings), ...list(src.found)]) {
    const f = normalizeFinding(r);
    if (!f || seen.has(`${f.kind}\n${f.id}`)) continue;
    seen.add(`${f.kind}\n${f.id}`);
    findings.push(f);
  }
  const counts = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return { findings, counts, fixable: findings.filter((f) => f.fixable).length, total: findings.length };
}

/** Findings by kind, known kinds first and in their fixed order; empty groups are left out. */
export function groupFindings(findings) {
  const kinds = [...KINDS, ...new Set(findings.map((f) => f.kind).filter((k) => !KINDS.includes(k)))];
  return kinds
    .map((kind) => {
      const rows = findings.filter((f) => f.kind === kind).sort((a, b) => Number(b.fixable) - Number(a.fixable) || a.id.localeCompare(b.id));
      return { kind, ...(KIND_TEXT[kind] ?? { ...OTHER, title: kind }), rows, fixable: rows.filter((f) => f.fixable).length };
    })
    .filter((g) => g.rows.length);
}

/** Why the scan flagged it, in plain words. */
export function evidenceText(f) {
  if (f.kind === 'orphan-profile') return f.evidence ? `profile ${f.evidence.split(/,\s*/).map((p) => `"${p}"`).join(', ')} is gone` : 'its profile is gone';
  if (f.evidence === 'merged') return 'its PR merged';
  if (f.evidence === 'steps-done') return 'every step is done';
  return f.evidence || 'it finished';
}

/** What the fix does to it ('' when there is no fix). */
export function fixText(f) {
  if (!f.fixable) return '';
  if (f.kind === 'orphan-profile') return `move to ${f.to || 'the base profile'}`;
  return `${f.status || 'archived'} → ${f.to || 'complete'}`;
}

/** The one-line headline over the list. */
export function summaryText(scan) {
  if (!scan.total) return 'Nothing to clean up.';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  const done = scan.counts['archived-complete'] ?? 0;
  const orphan = scan.counts['orphan-profile'] ?? 0;
  const other = scan.total - done - orphan;
  if (done) parts.push(`${plural(done, 'archived build is', 'archived builds are')} really finished`);
  if (orphan) parts.push(`${plural(orphan, 'build is', 'builds are')} in a profile that no longer exists`);
  if (other) parts.push(plural(other, 'other finding', 'other findings'));
  const stuck = scan.total - scan.fixable;
  return `${parts.join(' · ')}.${stuck ? ` ${plural(stuck, 'needs', 'need')} a look: no proof on record to fix ${stuck === 1 ? 'it' : 'them'} here.` : ''}`;
}

/** The body for the fix route: every fixable finding, or only the builds named (unfixable and unknown ids dropped). */
export function fixRequest(scan, { ids = null, profile = '' } = {}) {
  const fixable = scan.findings.filter((f) => f.fixable).map((f) => f.id);
  const want = ids ? [...new Set(ids)].filter((id) => fixable.includes(id)) : [...new Set(fixable)];
  return { builds: want, ...(profile ? { profile } : {}) };
}

/**
 * The fix route's answer → { fixed: [{ id, kind, to }], refused: [{ id, why }], left }. `asked` (the ids sent) fills
 * in when the route reports only that it worked; `left` is what the scan still finds, when the route says.
 */
export function normalizeFix(raw, asked = []) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rep = src.report && typeof src.report === 'object' ? src.report : src;
  const row = (r) => (typeof r === 'string' ? { id: r } : r && typeof r === 'object' ? r : {});
  const refused = list(rep.refused).map(row).map((r) => ({ id: str(r.id, 120) || str(r.build, 120), why: str(r.why) || 'the store kept its status' })).filter((r) => r.id);
  const turnedDown = new Set(refused.map((r) => r.id));
  let fixed = list(rep.fixed).map(row).map((r) => ({ id: str(r.id, 120) || str(r.build, 120), kind: str(r.kind, 40), to: str(r.to, 40) })).filter((r) => r.id);
  if (!Array.isArray(rep.fixed) && src.ok !== false) fixed = asked.filter((id) => !turnedDown.has(id)).map((id) => ({ id, kind: '', to: '' }));
  const left = Number.isFinite(rep.left) ? rep.left : null;
  return { fixed, refused, left };
}

/** What to tell the person after a fix: { tone, text }. */
export function fixMessage(result) {
  const { fixed, refused } = result;
  const n = fixed.length;
  if (!n && !refused.length) return { tone: 'info', text: 'Nothing needed fixing.' };
  const done = n ? `${n} build${n === 1 ? '' : 's'} fixed${n === 1 && fixed[0].to ? `: ${fixed[0].id} is now ${fixed[0].to}` : ''}.` : '';
  const not = refused.length ? `${refused.length} not changed (${refused.slice(0, 3).map((r) => `${r.id}: ${r.why}`).join('; ')}${refused.length > 3 ? '; …' : ''}).` : '';
  return { tone: refused.length ? (n ? 'warning' : 'danger') : 'success', text: [done, not].filter(Boolean).join(' ') };
}
