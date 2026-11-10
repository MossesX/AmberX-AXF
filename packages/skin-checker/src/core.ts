/**
 * The skin checker's one set of action handlers (Node only). Every surface calls these and nothing else:
 *   REST   the skin-editor console plugin's server runs `bin/skin-check.mjs call <action> '<json args>'`
 *   MCP    plugin commands (plugin-commands@1) call the REST routes
 *   CLI    `axf skin …` / `bin/skin-check.mjs` call them in-process
 *   voice  AmberX intents run the plugin commands
 * so every action gives the same JSON on every surface (SKIN_CHECK_SURFACES; the parity test checks it).
 *
 * State, all in the data folder (the plugin's lifecycle.dataDir, `AXF_SKIN_EDITOR_DIR` overrides it):
 *   settings.json               skin-check-settings@1, only what differs from the defaults is meaningful
 *   results/<skin>.json         the last result per skin (what `state` returns)
 *   assets/<type>/<id>.json     fixed copies of assets; they shadow the built-ins for the checker and the editor
 *
 * Every handler returns `{ ok: true, … }` or `{ ok: false, code, message }` (code: invalid | not_found); nothing throws.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKIN_CHECK_SURFACES, SKIN_CHECK_TARGET, parseIssueId, parseTokenKey, skinCheckLink, type SkinCheckAction, type SkinCheckApplied, type SkinCheckResult } from './contract.ts';
import { changedSettings, defaultSettings, flattenSettings, normalizeSettings, setSetting, settingsErrors, settingsGroups, type SkinCheckSettings } from './settings-schema.ts';
import { skinChecker } from './index.ts';
import { readToken } from './engine.ts';
import { REPO_ROOT, listSkins, loadSubject, persistWrites } from './load-skin.ts';

export interface CoreOptions {
  /** The data folder; default `AXF_SKIN_EDITOR_DIR`, else the hosting plugin's data folder under `<repo>/.axf-console/plugins`. */
  dataDir?: string;
  root?: string;
  /** Fixed time for reproducible results (tests). */
  now?: Date;
  /** CLI `--in-place`: fixes rewrite the repo's asset files instead of the data folder's copies. */
  inPlace?: boolean;
}
export type CoreAnswer = { ok: true; [k: string]: unknown } | { ok: false; code: 'invalid' | 'not_found'; message: string };

const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const bad = (message: string): CoreAnswer => ({ ok: false, code: 'invalid', message });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function dataDirOf(o: CoreOptions = {}): string {
  return o.dataDir ?? process.env.AXF_SKIN_EDITOR_DIR ?? join(o.root ?? REPO_ROOT, '.axf-console', 'plugins', 'skin-editor');
}
function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file: string, data: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

/* ---------------- settings ---------------- */

export function loadSettings(o: CoreOptions = {}): SkinCheckSettings {
  return normalizeSettings(readJson(join(dataDirOf(o), 'settings.json')));
}
function settingsAnswer(settings: SkinCheckSettings): CoreAnswer {
  return { ok: true, settings, flat: flattenSettings(settings), changed: changedSettings(settings) };
}
/** Dotted key → value for every leaf of a partial settings document (nested or flat), `rules.<id>` included. */
function leaves(raw: Record<string, unknown>, prefix = ''): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (k === '$axf') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) out.push(...leaves(v, key)); else out.push([key, v]);
  }
  return out;
}

/* ---------------- results ---------------- */

const resultFile = (o: CoreOptions, skin: string) => join(dataDirOf(o), 'results', `${skin}.json`);
function runCheck(skin: string, o: CoreOptions): { result: SkinCheckResult; error?: undefined } | { result?: undefined; error: CoreAnswer } {
  if (!SKIN_ID.test(skin)) return { error: bad('skin must be a skin or design package id') };
  const got = loadSubject(skin, { root: o.root, overlayDir: dataDirOf(o) });
  if (!got.subject) return { error: { ok: false, code: 'not_found', message: got.error } };
  const result = skinChecker.check(got.subject, loadSettings(o), o.now);
  writeJson(resultFile(o, skin), result);
  return { result };
}
const summary = (r: SkinCheckResult) => ({ skin: r.skin, score: r.score, grade: r.grade, pass: r.pass, counts: r.counts, fixable: r.fixable, at: r.at });

function applyAndSave(skin: string, o: CoreOptions, pick: (r: SkinCheckResult) => readonly string[] | null): CoreAnswer {
  const first = runCheck(skin, o);
  if (first.error) return first.error;
  const ids = pick(first.result);
  if (!ids) return bad('issues must be a non-empty list of issue ids');
  const malformed = ids.filter((id) => !parseIssueId(id));
  if (malformed.length) return bad(`not an issue id: ${malformed.slice(0, 3).join(', ')}`);
  const subject = loadSubject(skin, { root: o.root, overlayDir: dataDirOf(o) }).subject!;
  const applied: SkinCheckApplied = skinChecker.applyFixes(subject, first.result, ids);
  const files = persistWrites(applied.subject, applied.writes, { root: o.root, overlayDir: dataDirOf(o), inPlace: o.inPlace });
  const after = runCheck(skin, o);
  if (after.error) return after.error;
  return {
    ok: true,
    applied: { writes: applied.writes, fixed: applied.fixed, unfixable: applied.unfixable, files: files.map((f) => f.replace(`${o.root ?? REPO_ROOT}/`, '')) },
    before: summary(first.result),
    result: after.result,
  };
}

/* ---------------- the actions ---------------- */

export const ACTIONS = ['skins', 'check', 'check_all', 'state', 'fix', 'fix_all', 'set', 'settings_get', 'settings_set', 'settings_reset', 'open', 'surfaces'] as const;
export type CoreAction = typeof ACTIONS[number];

export function call(action: string, args: Record<string, unknown> = {}, o: CoreOptions = {}): CoreAnswer {
  const skin = typeof args.skin === 'string' ? args.skin.trim() : '';
  switch (action as CoreAction) {
    case 'skins': {
      const dir = dataDirOf(o);
      return {
        ok: true,
        skins: listSkins({ root: o.root, overlayDir: dir }).map((s) => {
          const last = readJson(resultFile(o, s.id)) as SkinCheckResult | null;
          return { ...s, last: last && last.$axf === 'skin-check@1' ? summary(last) : null };
        }),
      };
    }
    case 'check': {
      const r = runCheck(skin, o);
      return r.error ?? { ok: true, result: r.result };
    }
    case 'state': {
      if (!SKIN_ID.test(skin)) return bad('skin must be a skin or design package id');
      const last = readJson(resultFile(o, skin)) as SkinCheckResult | null;
      if (last && last.$axf === 'skin-check@1') return { ok: true, result: last, cached: true };
      const r = runCheck(skin, o);
      return r.error ?? { ok: true, result: r.result, cached: false };
    }
    case 'check_all': {
      const skins = listSkins({ root: o.root, overlayDir: dataDirOf(o) });
      const results: SkinCheckResult[] = [];
      for (const s of skins) {
        const r = runCheck(s.id, o);
        if (r.result) results.push(r.result);
      }
      const failing = results.filter((r) => !r.pass).map((r) => r.skin.id);
      return { ok: true, pass: failing.length === 0, failing, settings: loadSettings(o), results };
    }
    case 'fix': {
      const issues = Array.isArray(args.issues) ? args.issues.filter((x): x is string => typeof x === 'string') : typeof args.issue === 'string' ? [args.issue] : [];
      return applyAndSave(skin, o, () => (issues.length ? issues : null));
    }
    case 'fix_all':
      return applyAndSave(skin, o, (r) => r.issues.filter((i) => i.fix).map((i) => i.id));
    case 'set': {
      // one token write (the editor's inline edit), then a fresh check: { skin, token: '<type>:<id>/<path>', value }
      if (!SKIN_ID.test(skin)) return bad('skin must be a skin or design package id');
      const token = typeof args.token === 'string' ? parseTokenKey(args.token) : null;
      if (!token) return bad('token must be a token key: <type>:<id>/<path> (as on an issue)');
      if (typeof args.value !== 'string' && typeof args.value !== 'number') return bad('value must be a string or a number');
      const got = loadSubject(skin, { root: o.root, overlayDir: dataDirOf(o) });
      if (!got.subject) return { ok: false, code: 'not_found', message: got.error };
      const was = readToken(got.subject, token);
      if (was === undefined || (typeof was === 'object' && was !== null)) return { ok: false, code: 'not_found', message: `${args.token} is not a value of this skin` };
      // keep the token's kind: a number stays a number
      const value = typeof was === 'number' ? Number(args.value) : String(args.value).trim();
      if (typeof value === 'number' && !Number.isFinite(value)) return bad(`${args.token} is a number`);
      if (typeof value === 'string' && (!value || value.length > 300)) return bad('value must be 1-300 characters');
      const write = { token, value };
      const subject = skinChecker.write(got.subject, write);
      const files = persistWrites(subject, [write], { root: o.root, overlayDir: dataDirOf(o), inPlace: o.inPlace });
      const after = runCheck(skin, o);
      if (after.error) return after.error;
      return { ok: true, write: { ...write, was }, files: files.map((f) => f.replace(`${o.root ?? REPO_ROOT}/`, '')), result: after.result };
    }
    case 'settings_get':
      return { ...settingsAnswer(loadSettings(o)), ...(args.schema ? { groups: settingsGroups() } : {}) };
    case 'settings_set': {
      const patch = isObj(args.settings) ? args.settings : typeof args.key === 'string' ? { [args.key]: args.value } : null;
      if (!patch || !Object.keys(patch).length) return bad('settings must be an object of setting → value (or key and value)');
      const flatPatch: [string, unknown][] = leaves(patch);
      // a dotted key given flat ("contrast.text") and nested ({contrast: {text}}) is one key: validate it as written
      const errs = settingsErrors(patch);
      if (errs.length) return bad(errs.join('; '));
      let s = loadSettings(o);
      for (const [k, v] of flatPatch) {
        const next = setSetting(s, k, v);
        if (next.error !== undefined) return bad(next.error);
        s = next.settings!;
      }
      writeJson(join(dataDirOf(o), 'settings.json'), s);
      return settingsAnswer(s);
    }
    case 'settings_reset': {
      const s = defaultSettings();
      writeJson(join(dataDirOf(o), 'settings.json'), s);
      return settingsAnswer(s);
    }
    case 'open': {
      const issue = typeof args.issue === 'string' && args.issue ? args.issue : undefined;
      if (skin && !SKIN_ID.test(skin)) return bad('skin must be a skin or design package id');
      if (issue && !parseIssueId(issue)) return bad('issue must be an issue id');
      // the console action form too: console_show `action:skin-editor.checker:<skin>:<issueId>`
      const action = [SKIN_CHECK_TARGET.replace('/', '.'), ...(skin ? [skin] : []), ...(skin && issue ? [issue] : [])].join(':');
      return { ok: true, target: skinCheckLink(skin || undefined, issue), action };
    }
    case 'surfaces':
      return { ok: true, surfaces: SKIN_CHECK_SURFACES };
    default:
      return bad(`unknown action ${action}; one of ${ACTIONS.join(', ')}`);
  }
}

/** The core action behind a contract action (they match one to one; `open` returns the deep link). */
export const CORE_OF: Record<SkinCheckAction, CoreAction> = {
  check: 'check', state: 'state', fix: 'fix', fix_all: 'fix_all', settings_get: 'settings_get', settings_set: 'settings_set', settings_reset: 'settings_reset', open: 'open',
};
export const hasData = (o: CoreOptions = {}): boolean => existsSync(dataDirOf(o));
