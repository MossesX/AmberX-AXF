/**
 * skin-check@1 — the skin checker contract (build skin-checker, Fable, Nov 10 2026).
 *
 * A plain-code checker (no AI) that flags anything in a skin that breaks a professional look: spacing and sizing off
 * the token scale, more than a couple of font families or off-scale type sizes, palette sprawl and near-duplicate
 * colours, WCAG contrast failures, and inconsistent radius / border / shadow use. It runs live in the skin editor and
 * in CI, and every one of its actions is reachable through REST, MCP, the CLI and voice (Brett, Nov 8 2026:
 * "Everything comes with an API").
 *
 * This module is the one source of truth those surfaces share: the issue shape, the token reference a fix points at,
 * the score formula, the result envelope, the rule and engine interfaces, and the names of every action on every
 * surface. It is pure and runtime-free: types, constants and small functions that need no DOM, no file system and no
 * network. The engine (`engine.ts`), the loader (`load-skin.ts`) and the rules (`rules/*.ts`) build on it; the REST
 * routes, MCP tools, CLI and voice intents call the engine and never re-implement any of this.
 *
 * The threshold settings live in `settings-schema.ts` (skin-check-settings@1). Kotlin twin deferred
 * (framework/spec/PORTING.md, "skin-check@1").
 */
import type { SkinData } from '../../../framework/core/engines/skin';
import type { ScaleData } from '../../../framework/core/engines/scale-rules.mjs';
import type { ColorThemeData, StyleThemeData } from '../../../framework/core/types';
import type { SkinCheckSettings } from './settings-schema.ts';

export const SKIN_CHECK_FRAME = 'skin-check@1' as const;

/* ------------------------------------------------------------------------------------------------------------------
 * Categories, severities, rules
 * ---------------------------------------------------------------------------------------------------------------- */

/** The five things the checker looks at; one category per rule, one settings group per category. */
export type SkinCheckCategory = 'spacing' | 'typography' | 'palette' | 'contrast' | 'shape';
export const SKIN_CHECK_CATEGORIES: readonly SkinCheckCategory[] = ['spacing', 'typography', 'palette', 'contrast', 'shape'];
export const SKIN_CHECK_CATEGORY_LABEL: Record<SkinCheckCategory, string> = {
  spacing: 'Spacing and sizing',
  typography: 'Typography',
  palette: 'Palette',
  contrast: 'Contrast',
  shape: 'Radius, borders and shadows',
};

/**
 * error   = breaks the look or fails accessibility: text you cannot read, a third typeface, a colour nobody can tell
 *           from another. The skin fails CI with one of these while `failOnError` is on.
 * warning = looks unprofessional but still works: a padding off the scale, one radius too many.
 * info    = worth a look, no penalty to speak of.
 * off     = the rule stays registered but produces nothing (a settings override, never a rule default).
 */
export type SkinCheckSeverity = 'error' | 'warning' | 'info';
export type SkinCheckSeverityOverride = SkinCheckSeverity | 'off';
export const SKIN_CHECK_SEVERITIES: readonly SkinCheckSeverity[] = ['error', 'warning', 'info'];
export const severityRank = (s: SkinCheckSeverity): number => SKIN_CHECK_SEVERITIES.indexOf(s);

/**
 * Rule ids are `<category>.<what>`; stable keys in results, settings overrides, deep links and voice. The list is open
 * (a later rule adds a row here and a file under rules/), but every rule a surface can name is in SKIN_CHECK_RULES, so
 * the CLI, MCP and settings UI list rules from this table and never from the rule files.
 */
export type SkinCheckRuleId =
  | 'spacing.off-scale'
  | 'spacing.too-many-steps'
  | 'typography.font-families'
  | 'typography.off-scale'
  | 'palette.sprawl'
  | 'palette.near-duplicate'
  | 'contrast.text'
  | 'contrast.large-text'
  | 'contrast.ui'
  | 'shape.radius'
  | 'shape.border'
  | 'shape.shadow';

export interface SkinCheckRuleMeta {
  id: SkinCheckRuleId;
  category: SkinCheckCategory;
  /** The severity the rule reports with unless settings override it. */
  severity: SkinCheckSeverity;
  title: string;
  /** One line for the settings UI, the CLI's `rules` listing and the MCP tool description. */
  what: string;
  /** Setting keys (settings-schema.ts) the rule reads; the settings UI shows them under the rule. */
  settings: readonly string[];
  /** The rule can write a fix for (some of) its issues. */
  fixes: boolean;
}

export const SKIN_CHECK_RULES: readonly SkinCheckRuleMeta[] = [
  { id: 'spacing.off-scale', category: 'spacing', severity: 'warning', title: 'Spacing off the scale', what: 'A padding, gap, margin, width or height step that sits off the density gap scale; the nearest step is the fix.', settings: ['spacing.tolerance'], fixes: true },
  { id: 'spacing.too-many-steps', category: 'spacing', severity: 'info', title: 'Too many spacing steps', what: 'More distinct spacing values in use than the scale has steps.', settings: ['spacing.maxDistinct'], fixes: false },
  { id: 'typography.font-families', category: 'typography', severity: 'error', title: 'Too many typefaces', what: 'More font families than allowed across the body, display and mono stacks and the skin parts.', settings: ['typography.maxFamilies'], fixes: true },
  { id: 'typography.off-scale', category: 'typography', severity: 'warning', title: 'Type size off the scale', what: 'A text size that is not a step of the type scale; the nearest step is the fix.', settings: ['typography.sizeTolerance'], fixes: true },
  { id: 'palette.sprawl', category: 'palette', severity: 'warning', title: 'Palette sprawl', what: 'More distinct colours than a professional palette carries.', settings: ['palette.maxColors'], fixes: false },
  { id: 'palette.near-duplicate', category: 'palette', severity: 'warning', title: 'Near-duplicate colours', what: 'Two colour tokens closer than the OKLab deltaE threshold; the fix merges one into the canonical token.', settings: ['palette.nearDuplicateDeltaE'], fixes: true },
  { id: 'contrast.text', category: 'contrast', severity: 'error', title: 'Text contrast', what: 'Body text over a surface it is drawn on below the WCAG AA ratio; the fix is the nearest passing shade.', settings: ['contrast.text'], fixes: true },
  { id: 'contrast.large-text', category: 'contrast', severity: 'error', title: 'Large text contrast', what: 'Headings and large text below the WCAG AA large-text ratio.', settings: ['contrast.largeText'], fixes: true },
  { id: 'contrast.ui', category: 'contrast', severity: 'error', title: 'Icon and control contrast', what: 'Icons, borders and control edges below the WCAG non-text ratio.', settings: ['contrast.ui'], fixes: true },
  { id: 'shape.radius', category: 'shape', severity: 'warning', title: 'Radius use', what: 'A radius outside the token set, or more distinct radii than allowed.', settings: ['shape.maxRadii'], fixes: true },
  { id: 'shape.border', category: 'shape', severity: 'warning', title: 'Border width use', what: 'A border width outside the token set, or more distinct widths than allowed.', settings: ['shape.maxBorderWidths'], fixes: true },
  { id: 'shape.shadow', category: 'shape', severity: 'info', title: 'Shadow use', what: 'A shadow outside the token set, or more distinct shadows than allowed.', settings: ['shape.maxShadows'], fixes: false },
];
const RULE_BY_ID: Record<string, SkinCheckRuleMeta> = Object.fromEntries(SKIN_CHECK_RULES.map((r) => [r.id, r]));
export const isSkinCheckRuleId = (id: string): id is SkinCheckRuleId => id in RULE_BY_ID;
export const skinCheckRule = (id: SkinCheckRuleId): SkinCheckRuleMeta => RULE_BY_ID[id]!;

/* ------------------------------------------------------------------------------------------------------------------
 * Token references: where a value lives, so the editor can jump to it and a fix can write it
 * ---------------------------------------------------------------------------------------------------------------- */

/** The asset a token belongs to. `skin` = the skin document itself (its `parts`), the others = the assets it names. */
export type SkinCheckTokenType = 'skin' | 'color-theme' | 'style-theme' | 'typography' | 'density' | 'sizing';
export const SKIN_CHECK_TOKEN_TYPES: readonly SkinCheckTokenType[] = ['skin', 'color-theme', 'style-theme', 'typography', 'density', 'sizing'];

/**
 * One value in one asset. `path` is the dotted path inside the asset's `data` (`tokens.accent`, `radius.sm`,
 * `gap.md`, `button.padX`, `parts.button.radius`); `cssVar` is the `--fx-*` variable it compiles to when there is one,
 * so an issue can also be read against the live page. The editor's one-click jump opens `type:id` at `path`.
 */
export interface SkinCheckTokenRef {
  type: SkinCheckTokenType;
  id: string;
  path: string;
  cssVar?: string;
}

const TOKEN_ID = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN_PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
/** `<type>:<id>/<path>`, the stable string form used in issue ids, deep links (`?issue=`), the CLI and voice. */
export function tokenKey(t: SkinCheckTokenRef): string {
  return `${t.type}:${t.id}/${t.path}`;
}
export function parseTokenKey(key: string): SkinCheckTokenRef | null {
  const m = /^([a-z-]+):([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(key);
  if (!m) return null;
  const type = m[1] as SkinCheckTokenType;
  if (!SKIN_CHECK_TOKEN_TYPES.includes(type) || !TOKEN_PATH.test(m[3]!)) return null;
  return { type, id: m[2]!, path: m[3]! };
}
export const isTokenRef = (v: unknown): v is SkinCheckTokenRef =>
  typeof v === 'object' && v !== null
  && SKIN_CHECK_TOKEN_TYPES.includes((v as SkinCheckTokenRef).type)
  && typeof (v as SkinCheckTokenRef).id === 'string' && TOKEN_ID.test((v as SkinCheckTokenRef).id)
  && typeof (v as SkinCheckTokenRef).path === 'string' && TOKEN_PATH.test((v as SkinCheckTokenRef).path);

/* ------------------------------------------------------------------------------------------------------------------
 * Issues and fixes
 * ---------------------------------------------------------------------------------------------------------------- */

export type SkinCheckValue = string | number;

/**
 * What a fix writes. Every fix is one or more token writes, so applying it is the same operation on every surface:
 * the editor writes the asset, the REST route persists it, the CLI prints or writes it. `merge` is a `set` that also
 * says which canonical token the value came from (near-duplicate colours), so the UI can say "merge into accent".
 */
export interface SkinCheckWrite { token: SkinCheckTokenRef; value: SkinCheckValue }
export interface SkinCheckFix {
  kind: 'set' | 'merge';
  /** Button label: "Snap to gap.md (0.5)", "Merge into accent", "Darken text to pass 4.5:1". */
  label: string;
  writes: SkinCheckWrite[];
  /** `merge`: the token whose value wins. */
  into?: SkinCheckTokenRef;
}

export interface SkinCheckIssue {
  /** Stable within a skin: `<rule>@<tokenKey>` or `<rule>@<tokenKey>~<againstKey>` for a pair (issueId()). */
  id: string;
  rule: SkinCheckRuleId;
  category: SkinCheckCategory;
  severity: SkinCheckSeverity;
  /** Where the offending value lives. */
  token: SkinCheckTokenRef;
  /** The value as written in the asset. */
  value: SkinCheckValue;
  /** What a professional skin would have there, in words: "a gap step: 0.25, 0.4, 0.5 …", "at least 4.5:1". */
  expected: string;
  /** One plain line for a list row, the CLI and voice. */
  message: string;
  /** The other half of a pair (contrast: the background; near-duplicate: the canonical colour). */
  against?: SkinCheckTokenRef;
  /** What the rule measured: a contrast ratio, a deltaE, a count, a distance from the nearest step. */
  measured?: number;
  /** Present when the engine can fix it in one click; absent = the person has to decide. */
  fix?: SkinCheckFix;
}

/** Issue ids are the fix / jump target on every surface (`skin_check_fix <skin> <issueId>`, `?issue=`). */
export function issueId(rule: SkinCheckRuleId, token: SkinCheckTokenRef, against?: SkinCheckTokenRef): string {
  return `${rule}@${tokenKey(token)}${against ? `~${tokenKey(against)}` : ''}`;
}
export function parseIssueId(id: string): { rule: SkinCheckRuleId; token: SkinCheckTokenRef; against?: SkinCheckTokenRef } | null {
  const at = id.indexOf('@');
  if (at < 0) return null;
  const rule = id.slice(0, at);
  if (!isSkinCheckRuleId(rule)) return null;
  const [a, b, ...rest] = id.slice(at + 1).split('~');
  if (rest.length || !a) return null;
  const token = parseTokenKey(a);
  if (!token) return null;
  if (b === undefined) return { rule, token };
  const against = parseTokenKey(b);
  return against ? { rule, token, against } : null;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Score
 * ---------------------------------------------------------------------------------------------------------------- */

/**
 * The score is 100 minus a penalty per issue, weighted by severity, with each category capped so one runaway rule
 * (forty off-scale paddings) cannot zero the score on its own, clamped to 0..100 and rounded to a whole number:
 *
 *   penalty(category) = min(CAP, Σ WEIGHT[severity])          CAP = 40
 *   score             = max(0, 100 − Σ penalty(category))      WEIGHT: error 10, warning 4, info 1
 *
 * A skin passes when score ≥ settings.minScore and, while settings.failOnError is on, it has no error. Grades are
 * bands on the score for the badge and voice ("Fresh scores 92, grade A").
 */
export const SCORE_WEIGHT: Record<SkinCheckSeverity, number> = { error: 10, warning: 4, info: 1 };
export const SCORE_CATEGORY_CAP = 40;
export const SCORE_MAX = 100;
export type SkinCheckGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export const SCORE_GRADES: readonly { min: number; grade: SkinCheckGrade }[] = [
  { min: 90, grade: 'A' },
  { min: 75, grade: 'B' },
  { min: 60, grade: 'C' },
  { min: 40, grade: 'D' },
  { min: 0, grade: 'F' },
];
export const gradeOf = (score: number): SkinCheckGrade => SCORE_GRADES.find((g) => score >= g.min)!.grade;

export interface SkinCheckCategoryScore { issues: number; penalty: number }
export interface SkinCheckScore {
  score: number;
  grade: SkinCheckGrade;
  pass: boolean;
  counts: Record<SkinCheckSeverity, number>;
  byCategory: Record<SkinCheckCategory, SkinCheckCategoryScore>;
}

/** The formula. Pure; the engine, CI, the editor badge and voice all call this and nothing else. */
export function scoreIssues(issues: readonly SkinCheckIssue[], settings: Pick<SkinCheckSettings, 'minScore' | 'failOnError'>): SkinCheckScore {
  const counts: Record<SkinCheckSeverity, number> = { error: 0, warning: 0, info: 0 };
  const byCategory = Object.fromEntries(SKIN_CHECK_CATEGORIES.map((c) => [c, { issues: 0, penalty: 0 }])) as Record<SkinCheckCategory, SkinCheckCategoryScore>;
  for (const i of issues) {
    counts[i.severity]++;
    const c = byCategory[i.category];
    c.issues++;
    c.penalty = Math.min(SCORE_CATEGORY_CAP, c.penalty + SCORE_WEIGHT[i.severity]);
  }
  const total = SKIN_CHECK_CATEGORIES.reduce((s, c) => s + byCategory[c].penalty, 0);
  const score = Math.max(0, Math.min(SCORE_MAX, Math.round(SCORE_MAX - total)));
  const pass = score >= settings.minScore && !(settings.failOnError && counts.error > 0);
  return { score, grade: gradeOf(score), pass, counts, byCategory };
}

/* ------------------------------------------------------------------------------------------------------------------
 * What the engine checks (the subject) and what it returns (the result)
 * ---------------------------------------------------------------------------------------------------------------- */

/** One asset with its id, as the loader found it. */
export interface SkinCheckAsset<T> { id: string; data: T }

/**
 * Everything the rules read, resolved once by the loader (load-skin.ts, not pure: it reads asset folders) or by the
 * editor from the assets it already holds. A missing asset is `null`: the rule that needs it is skipped and says so
 * in `result.skipped`, never a crash. `vars` is the compiled `--fx-*` map for this look (theme + scale engines), so a
 * rule can read what the page reads (`--fx-text`, `--fx-dens-gap-md`) and name it on the issue as `cssVar`.
 */
export interface SkinCheckSubject {
  skin: { id: string; name: string; kind: 'skin' | 'design-package'; data: SkinData };
  colorTheme: SkinCheckAsset<ColorThemeData> | null;
  styleTheme: SkinCheckAsset<StyleThemeData> | null;
  typography: SkinCheckAsset<ScaleData> | null;
  density: SkinCheckAsset<ScaleData> | null;
  sizing: SkinCheckAsset<ScaleData> | null;
  vars: Record<string, string>;
}

export interface SkinCheckSkipped { rule: SkinCheckRuleId; reason: string }

/** The result envelope: the same JSON from the engine, REST, MCP, `axf skin check --json` and the CI artifact. */
export interface SkinCheckResult extends SkinCheckScore {
  $axf: typeof SKIN_CHECK_FRAME;
  skin: { id: string; name: string; kind: 'skin' | 'design-package' };
  /** ISO time the check ran. */
  at: string;
  issues: SkinCheckIssue[];
  /** Rules that ran, in order. */
  rules: SkinCheckRuleId[];
  skipped: SkinCheckSkipped[];
  /** The effective settings the check used (defaults filled in), so a consumer can explain a verdict. */
  settings: SkinCheckSettings;
  /** Issues with a fix, so a UI can offer "Fix all N". */
  fixable: number;
}

/** Issues sorted the way every surface lists them: errors first, then by category order, then by token. */
export function sortIssues(issues: readonly SkinCheckIssue[]): SkinCheckIssue[] {
  return [...issues].sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity)
    || SKIN_CHECK_CATEGORIES.indexOf(a.category) - SKIN_CHECK_CATEGORIES.indexOf(b.category)
    || a.rule.localeCompare(b.rule)
    || tokenKey(a.token).localeCompare(tokenKey(b.token)));
}

/* ------------------------------------------------------------------------------------------------------------------
 * Rules and the engine: pure functions every surface shares
 * ---------------------------------------------------------------------------------------------------------------- */

/** What a rule gets. `report` fills in id, category and the (possibly overridden) severity from the rule's meta. */
export interface SkinCheckRuleContext {
  subject: SkinCheckSubject;
  settings: SkinCheckSettings;
  report(issue: Omit<SkinCheckIssue, 'id' | 'rule' | 'category' | 'severity'> & { severity?: SkinCheckSeverity }): SkinCheckIssue;
}

/**
 * A rule: its meta row plus a pure `run`. `needs` lists the subject assets it cannot work without; the engine skips
 * the rule (result.skipped) when one is null instead of calling it.
 */
export interface SkinCheckRule {
  meta: SkinCheckRuleMeta;
  needs: readonly Exclude<keyof SkinCheckSubject, 'skin' | 'vars'>[];
  run(ctx: SkinCheckRuleContext): SkinCheckIssue[];
}

/** What applying fixes returns: the subject after the writes, and the writes, so a caller can persist them. */
export interface SkinCheckApplied {
  subject: SkinCheckSubject;
  writes: SkinCheckWrite[];
  /** Issue ids that were fixed. */
  fixed: string[];
  /** Issue ids asked for that had no fix or were not found. */
  unfixable: string[];
}

/**
 * The engine. Pure: the same subject and settings give the same result; nothing here touches a file, the DOM or the
 * network. The skin editor calls it on every (debounced) token edit, CI calls it per skin, the REST routes call it
 * and the MCP tools, CLI and voice call the REST routes.
 */
export interface SkinCheckEngine {
  /** The registered rules, in run order. */
  rules(): readonly SkinCheckRule[];
  /** Run every rule not switched off; `now` is injectable so results are reproducible in tests. */
  /** `settings` may be nested or flat dotted keys (`{ 'contrast.text': 7 }`); normalizeSettings fills the rest. */
  check(subject: SkinCheckSubject, settings?: Partial<SkinCheckSettings> | Record<string, unknown> | null, now?: Date): SkinCheckResult;
  /** Apply the fixes of the given issues (by id) to the subject; writes are returned for the caller to persist. */
  applyFixes(subject: SkinCheckSubject, result: SkinCheckResult, issueIds: readonly string[]): SkinCheckApplied;
  /** Apply every fix the result offers. */
  applyAllFixes(subject: SkinCheckSubject, result: SkinCheckResult): SkinCheckApplied;
  /** Write one token value into a subject (what a fix does; also what the editor does on a manual edit). */
  write(subject: SkinCheckSubject, write: SkinCheckWrite): SkinCheckSubject;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Surfaces: the same actions on REST, MCP, CLI and voice, and the deep link
 * ---------------------------------------------------------------------------------------------------------------- */

/** The console_show / console_open target of the checker panel; `?skin=<id>&issue=<issueId>` selects and scrolls. */
export const SKIN_CHECK_TARGET = 'skin-editor/checker';
export function skinCheckLink(skinId?: string, issueId?: string): string {
  const q = new URLSearchParams();
  if (skinId) q.set('skin', skinId);
  if (issueId) q.set('issue', issueId);
  const s = q.toString();
  return s ? `${SKIN_CHECK_TARGET}?${s}` : SKIN_CHECK_TARGET;
}

export type SkinCheckAction = 'check' | 'state' | 'fix' | 'fix_all' | 'settings_get' | 'settings_set' | 'settings_reset' | 'open';
export interface SkinCheckSurface {
  action: SkinCheckAction;
  /** control@1 effect. */
  effect: 'read' | 'write' | 'navigate';
  /** REST, under the console API. `:skin` = skin or design-package id. */
  rest: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string };
  /** MCP console action / plugin command name. */
  mcp: string;
  /** `axf skin …` */
  cli: string;
  /** AmberX intent id. */
  voice: string;
  what: string;
}

/**
 * One table drives the route file, the MCP tool file, the CLI and the voice intents; the parity test (s13) walks it
 * and calls every action through every surface, expecting the same JSON. `state` is the last result kept per skin
 * (what the editor shows without re-running); `check` runs and replaces it.
 */
export const SKIN_CHECK_SURFACES: readonly SkinCheckSurface[] = [
  { action: 'check', effect: 'write', rest: { method: 'POST', path: '/api/skin-checker/:skin/check' }, mcp: 'skin_check', cli: 'skin check <skin>', voice: 'skin.check', what: 'Run the checker on a skin; returns skin-check@1.' },
  { action: 'state', effect: 'read', rest: { method: 'GET', path: '/api/skin-checker/:skin' }, mcp: 'skin_check_state', cli: 'skin check <skin> --cached', voice: 'skin.check.state', what: 'The last result for a skin (runs the check if there is none).' },
  { action: 'fix', effect: 'write', rest: { method: 'POST', path: '/api/skin-checker/:skin/fix' }, mcp: 'skin_check_fix', cli: 'skin fix <skin> <issueId…>', voice: 'skin.check.fix', what: 'Apply the fix of one or more issues (body: { issues: string[] }); returns the writes and the new result.' },
  { action: 'fix_all', effect: 'write', rest: { method: 'POST', path: '/api/skin-checker/:skin/fix-all' }, mcp: 'skin_check_fix_all', cli: 'skin fix <skin> --all', voice: 'skin.check.fix.all', what: 'Apply every fix the last result offers.' },
  { action: 'settings_get', effect: 'read', rest: { method: 'GET', path: '/api/skin-checker/settings' }, mcp: 'skin_check_settings_get', cli: 'skin settings', voice: 'skin.check.settings.get', what: 'The threshold settings (skin-check-settings@1) with defaults filled in.' },
  { action: 'settings_set', effect: 'write', rest: { method: 'PUT', path: '/api/skin-checker/settings' }, mcp: 'skin_check_settings_set', cli: 'skin settings set <key> <value>', voice: 'skin.check.settings.set', what: 'Write one or more settings (body: partial, dotted keys or nested); validated against the schema.' },
  { action: 'settings_reset', effect: 'write', rest: { method: 'DELETE', path: '/api/skin-checker/settings' }, mcp: 'skin_check_settings_reset', cli: 'skin settings reset', voice: 'skin.check.settings.reset', what: 'Back to the defaults.' },
  { action: 'open', effect: 'navigate', rest: { method: 'POST', path: '/api/console/show' }, mcp: 'console_show', cli: 'skin open <skin> [issueId]', voice: 'skin.check.open', what: `Open the checker panel (target ${SKIN_CHECK_TARGET}, ?skin=&issue=).` },
];
export const skinCheckSurface = (action: SkinCheckAction): SkinCheckSurface => SKIN_CHECK_SURFACES.find((s) => s.action === action)!;

/** `axf skin check` exits with this when the skin does not pass (CI); 0 when it does, 2 on a usage or load error. */
export const SKIN_CHECK_EXIT_FAIL = 1;
