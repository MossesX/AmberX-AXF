/**
 * skin-check@1 engine: the rule registry and the runner (contract.ts SkinCheckEngine). Pure: no file system, no DOM,
 * no network. The same subject and settings give the same result; `now` is injectable for reproducible tests.
 *
 *   const engine = createSkinCheckEngine(ALL_RULES);
 *   const result = engine.check(subject, settings);
 *   const { subject: fixed, writes } = engine.applyAllFixes(subject, result);
 *
 * A rule never makes the engine throw: a rule that needs an asset the subject lacks is skipped with the reason, a
 * rule switched off in settings is skipped, and a rule that throws is skipped with its error (and the rest still run).
 */
import {
  SKIN_CHECK_FRAME, isTokenRef, issueId, scoreIssues, skinCheckRule, sortIssues,
  type SkinCheckApplied, type SkinCheckEngine, type SkinCheckIssue, type SkinCheckResult, type SkinCheckRule,
  type SkinCheckRuleContext, type SkinCheckRuleId, type SkinCheckSkipped, type SkinCheckSubject, type SkinCheckTokenRef,
  type SkinCheckTokenType, type SkinCheckWrite,
} from './contract.ts';
import { normalizeSettings, ruleSeverity, type SkinCheckSettings } from './settings-schema.ts';
import { subjectVars } from './vars.ts';

/** Subject key that holds the asset of each token type (`skin` = the skin document's own data). */
export const SUBJECT_KEY: Record<SkinCheckTokenType, keyof SkinCheckSubject> = {
  skin: 'skin', 'color-theme': 'colorTheme', 'style-theme': 'styleTheme', typography: 'typography', density: 'density', sizing: 'sizing',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The data object of the asset a token lives in, when the subject holds that asset under that id. */
export function assetData(subject: SkinCheckSubject, type: SkinCheckTokenType, id: string): Record<string, unknown> | null {
  const a = subject[SUBJECT_KEY[type]] as { id: string; data: unknown } | null;
  return a && a.id === id && isObj(a.data) ? a.data : null;
}

/** Read the value at a token reference, or undefined. */
export function readToken(subject: SkinCheckSubject, token: SkinCheckTokenRef): unknown {
  let cur: unknown = assetData(subject, token.type, token.id);
  for (const p of token.path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** A token reference into the subject's asset of that type (its id filled in). */
export function tokenRef(subject: SkinCheckSubject, type: SkinCheckTokenType, path: string, cssVar?: string): SkinCheckTokenRef {
  const a = subject[SUBJECT_KEY[type]] as { id: string } | null;
  return { type, id: a?.id ?? '', path, ...(cssVar ? { cssVar } : {}) };
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)) as T);

function writeSubject(subject: SkinCheckSubject, w: SkinCheckWrite): SkinCheckSubject {
  if (!isTokenRef(w.token) || !assetData(subject, w.token.type, w.token.id)) return subject;
  const key = SUBJECT_KEY[w.token.type];
  const asset = clone(subject[key]) as { id: string; data: Record<string, unknown> };
  const parts = w.token.path.split('.');
  let cur = asset.data;
  for (const p of parts.slice(0, -1)) {
    if (!isObj(cur[p])) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = w.value;
  const next = { ...subject, [key]: asset } as SkinCheckSubject;
  return { ...next, vars: subjectVars(next) };
}

export function createSkinCheckEngine(registered: readonly SkinCheckRule[]): SkinCheckEngine {
  const seen = new Set<string>();
  const rules = registered.filter((r) => (seen.has(r.meta.id) ? false : (seen.add(r.meta.id), true)));

  const engine: SkinCheckEngine = {
    rules: () => rules,

    check(subject, rawSettings, now = new Date()): SkinCheckResult {
      const settings: SkinCheckSettings = normalizeSettings(rawSettings ?? null);
      const issues: SkinCheckIssue[] = [];
      const ids = new Set<string>();
      const ran: SkinCheckRuleId[] = [];
      const skipped: SkinCheckSkipped[] = [];
      for (const rule of rules) {
        const id = rule.meta.id;
        const sev = ruleSeverity(settings, id);
        if (sev === 'off') { skipped.push({ rule: id, reason: 'switched off in settings' }); continue; }
        const missing = rule.needs.filter((n) => !subject[n]);
        if (missing.length) { skipped.push({ rule: id, reason: `the skin has no ${missing.join(', ')} asset` }); continue; }
        const override = settings.rules[id];
        const found: SkinCheckIssue[] = [];
        const ctx: SkinCheckRuleContext = {
          subject,
          settings,
          report(i) {
            const issue: SkinCheckIssue = {
              ...i,
              id: issueId(id, i.token, i.against),
              rule: id,
              category: rule.meta.category,
              severity: override && override !== 'off' ? override : i.severity ?? rule.meta.severity,
            };
            found.push(issue);
            return issue;
          },
        };
        try {
          rule.run(ctx);
        } catch (e) {
          skipped.push({ rule: id, reason: `failed: ${e instanceof Error ? e.message : String(e)}` });
          continue;
        }
        ran.push(id);
        for (const i of found) if (!ids.has(i.id)) { ids.add(i.id); issues.push(i); }
      }
      const sorted = sortIssues(issues);
      return {
        $axf: SKIN_CHECK_FRAME,
        skin: { id: subject.skin.id, name: subject.skin.name, kind: subject.skin.kind },
        at: now.toISOString(),
        ...scoreIssues(sorted, settings),
        issues: sorted,
        rules: ran,
        skipped,
        settings,
        fixable: sorted.filter((i) => i.fix).length,
      };
    },

    applyFixes(subject, result, issueIds): SkinCheckApplied {
      const byId = new Map(result.issues.map((i) => [i.id, i]));
      const written = new Set<string>();
      const writes: SkinCheckWrite[] = [];
      const fixed: string[] = [];
      const unfixable: string[] = [];
      let cur = subject;
      for (const id of [...new Set(issueIds)]) {
        const fix = byId.get(id)?.fix;
        if (!fix || !fix.writes.length) { unfixable.push(id); continue; }
        // Two fixes for the same token (a merge and a contrast shade on one colour): the first wins, the other waits
        // for the next run, which sees the new value.
        const fresh = fix.writes.filter((w) => !written.has(`${w.token.type}:${w.token.id}/${w.token.path}`));
        if (!fresh.length) { unfixable.push(id); continue; }
        for (const w of fresh) {
          const next = writeSubject(cur, w);
          if (next === cur) continue;
          cur = next;
          written.add(`${w.token.type}:${w.token.id}/${w.token.path}`);
          writes.push({ token: { type: w.token.type, id: w.token.id, path: w.token.path }, value: w.value });
        }
        fixed.push(id);
      }
      return { subject: cur, writes, fixed, unfixable };
    },

    applyAllFixes(subject, result) {
      return engine.applyFixes(subject, result, result.issues.filter((i) => i.fix).map((i) => i.id));
    },

    write: writeSubject,
  };
  return engine;
}

/** The rule meta row for a rule file: `defineRule('spacing.off-scale', ['density'], run)`. */
export function defineRule(id: SkinCheckRuleId, needs: SkinCheckRule['needs'], run: (ctx: SkinCheckRuleContext) => void): SkinCheckRule {
  return { meta: skinCheckRule(id), needs, run: (ctx) => { run(ctx); return []; } };
}
