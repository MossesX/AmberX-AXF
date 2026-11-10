/**
 * skin-check-settings@1 — the skin checker's threshold settings (build skin-checker, Fable, Nov 10 2026).
 *
 * ONE field table (SKIN_CHECK_SETTING_FIELDS) drives everything that touches a setting: the defaults, the normalizer
 * the engine runs before a check, the validator the REST route and the CLI run before a write, the JSON schema, and
 * the settings section of the checker panel (groups = the five categories plus "Passing"). A setting is addressed by
 * its dotted key (`contrast.text`) on every surface: `axf skin settings set contrast.text 7`, the MCP tool, the voice
 * intent and the panel all write through `setSetting`. Unknown keys are dropped, never an error; an out-of-range value
 * is clamped by the normalizer and reported by the validator (so a write refuses it while a stored file still loads).
 *
 * Per-rule severity overrides live under `rules.<ruleId>` (`error | warning | info | off`); `off` disables the rule.
 * Pure, no DOM. Kotlin twin deferred (framework/spec/PORTING.md, "skin-check@1").
 */
import { SKIN_CHECK_CATEGORY_LABEL, SKIN_CHECK_RULES, isSkinCheckRuleId, type SkinCheckCategory, type SkinCheckRuleId, type SkinCheckSeverityOverride } from './contract';

export const SKIN_CHECK_SETTINGS_FRAME = 'skin-check-settings@1' as const;

export type SkinCheckSettingKind = 'number' | 'boolean';
export type SkinCheckSettingGroup = SkinCheckCategory | 'passing';
export const SKIN_CHECK_SETTING_GROUPS: readonly SkinCheckSettingGroup[] = ['passing', 'spacing', 'typography', 'palette', 'contrast', 'shape'];
export const SKIN_CHECK_SETTING_GROUP_LABEL: Record<SkinCheckSettingGroup, string> = { passing: 'Passing', ...SKIN_CHECK_CATEGORY_LABEL };

export interface SkinCheckSettingField {
  key: string;
  group: SkinCheckSettingGroup;
  kind: SkinCheckSettingKind;
  default: number | boolean;
  /** Numbers: the range a write must stay in and the slider step. */
  min?: number;
  max?: number;
  step?: number;
  /** Shown after the value. */
  unit?: string;
  label: string;
  hint: string;
}

/** Key order = display order. */
export const SKIN_CHECK_SETTING_FIELDS: readonly SkinCheckSettingField[] = [
  // passing
  { key: 'minScore', group: 'passing', kind: 'number', default: 80, min: 0, max: 100, step: 1, label: 'Minimum score', hint: 'A skin passes (and CI is green) at this score or above.' },
  { key: 'failOnError', group: 'passing', kind: 'boolean', default: true, label: 'Any error fails', hint: 'One error-level issue fails the skin whatever the score.' },
  // spacing
  { key: 'spacing.tolerance', group: 'spacing', kind: 'number', default: 0.02, min: 0, max: 0.25, step: 0.01, unit: '×', label: 'Scale tolerance', hint: 'How far (as a fraction of the step) a value may sit from a gap step before it is off the scale.' },
  { key: 'spacing.maxDistinct', group: 'spacing', kind: 'number', default: 12, min: 3, max: 40, step: 1, label: 'Distinct spacing values', hint: 'More distinct spacing values in use than this is reported.' },
  // typography
  { key: 'typography.maxFamilies', group: 'typography', kind: 'number', default: 2, min: 1, max: 6, step: 1, label: 'Font families', hint: 'Body, display, mono and part fonts together; a third typeface is the usual tell.' },
  { key: 'typography.sizeTolerance', group: 'typography', kind: 'number', default: 0.02, min: 0, max: 0.25, step: 0.01, unit: '×', label: 'Type scale tolerance', hint: 'How far a text size may sit from a type-scale step before it is off the scale.' },
  // palette
  { key: 'palette.maxColors', group: 'palette', kind: 'number', default: 12, min: 4, max: 48, step: 1, label: 'Distinct colours', hint: 'Opaque colours after merging near-duplicates; a professional palette rarely needs more.' },
  { key: 'palette.nearDuplicateDeltaE', group: 'palette', kind: 'number', default: 2.5, min: 0.5, max: 10, step: 0.5, unit: 'ΔE', label: 'Near-duplicate distance', hint: 'Two colours closer than this (OKLab ΔE) are the same colour written twice.' },
  // contrast
  { key: 'contrast.text', group: 'contrast', kind: 'number', default: 4.5, min: 1, max: 21, step: 0.5, unit: ':1', label: 'Text', hint: 'WCAG AA body text is 4.5:1; AAA is 7:1.' },
  { key: 'contrast.largeText', group: 'contrast', kind: 'number', default: 3, min: 1, max: 21, step: 0.5, unit: ':1', label: 'Large text', hint: 'WCAG AA for headings and text from about 18 px bold or 24 px regular.' },
  { key: 'contrast.ui', group: 'contrast', kind: 'number', default: 3, min: 1, max: 21, step: 0.5, unit: ':1', label: 'Icons and controls', hint: 'WCAG non-text contrast for icons, borders and control edges.' },
  // shape
  { key: 'shape.maxRadii', group: 'shape', kind: 'number', default: 3, min: 1, max: 8, step: 1, label: 'Distinct radii', hint: 'The style theme has sm, md and lg; more than this in use looks unplanned.' },
  { key: 'shape.maxBorderWidths', group: 'shape', kind: 'number', default: 2, min: 1, max: 6, step: 1, label: 'Distinct border widths', hint: 'Hairline plus one emphasis width is plenty.' },
  { key: 'shape.maxShadows', group: 'shape', kind: 'number', default: 3, min: 1, max: 8, step: 1, label: 'Distinct shadows', hint: 'The style theme has sm, md and lg.' },
];
const FIELD_BY_KEY: Record<string, SkinCheckSettingField> = Object.fromEntries(SKIN_CHECK_SETTING_FIELDS.map((f) => [f.key, f]));
export const settingField = (key: string): SkinCheckSettingField | null => FIELD_BY_KEY[key] ?? null;
export const settingFields = (group?: SkinCheckSettingGroup): SkinCheckSettingField[] => SKIN_CHECK_SETTING_FIELDS.filter((f) => !group || f.group === group);

/** The typed shape the engine reads. Every field is present after `normalizeSettings`. */
export interface SkinCheckSettings {
  $axf: typeof SKIN_CHECK_SETTINGS_FRAME;
  minScore: number;
  failOnError: boolean;
  spacing: { tolerance: number; maxDistinct: number };
  typography: { maxFamilies: number; sizeTolerance: number };
  palette: { maxColors: number; nearDuplicateDeltaE: number };
  contrast: { text: number; largeText: number; ui: number };
  shape: { maxRadii: number; maxBorderWidths: number; maxShadows: number };
  /** Per-rule severity overrides; a rule not listed reports with its default severity. */
  rules: Partial<Record<SkinCheckRuleId, SkinCheckSeverityOverride>>;
}

const OVERRIDES: readonly SkinCheckSeverityOverride[] = ['error', 'warning', 'info', 'off'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function getPath(o: unknown, key: string): unknown {
  let cur: unknown = o;
  for (const part of key.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}
function setPath(o: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let cur = o;
  for (const part of parts.slice(0, -1)) {
    if (!isObj(cur[part])) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** Coerce one raw value to its field's kind; `null` = not usable. Strings are accepted (CLI, voice, query strings). */
export function coerceSetting(field: SkinCheckSettingField, raw: unknown): number | boolean | null {
  if (field.kind === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      if (['true', 'on', 'yes', '1'].includes(s)) return true;
      if (['false', 'off', 'no', '0'].includes(s)) return false;
    }
    return null;
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}
const clamp = (f: SkinCheckSettingField, n: number): number => Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));

/** The defaults, as a fresh document. */
export function defaultSettings(): SkinCheckSettings {
  return normalizeSettings(null);
}

/**
 * Fill every field from the raw document (flat dotted keys or nested objects, both accepted), clamp numbers into
 * range, drop unknown keys and bad rule overrides. Never throws.
 */
export function normalizeSettings(raw: unknown): SkinCheckSettings {
  const out: Record<string, unknown> = { $axf: SKIN_CHECK_SETTINGS_FRAME };
  for (const f of SKIN_CHECK_SETTING_FIELDS) {
    const flat = isObj(raw) ? raw[f.key] : undefined;
    const v = coerceSetting(f, flat !== undefined ? flat : getPath(raw, f.key));
    setPath(out, f.key, v === null ? f.default : typeof v === 'number' ? clamp(f, v) : v);
  }
  const rules: Partial<Record<SkinCheckRuleId, SkinCheckSeverityOverride>> = {};
  const rawRules = isObj(raw) ? raw.rules : undefined;
  if (isObj(rawRules)) for (const [k, v] of Object.entries(rawRules)) if (isSkinCheckRuleId(k) && typeof v === 'string' && OVERRIDES.includes(v as SkinCheckSeverityOverride)) rules[k] = v as SkinCheckSeverityOverride;
  out.rules = rules;
  return out as unknown as SkinCheckSettings;
}

/** What a write must not do: unknown key, wrong kind, out of range, unknown rule or severity. Empty = acceptable. */
export function settingsErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['settings must be an object'];
  const errs: string[] = [];
  const seen = new Set<string>();
  const visit = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (key === '$axf') continue;
      if (key === 'rules') {
        if (!isObj(v)) { errs.push('rules must be an object of rule id → error | warning | info | off'); continue; }
        for (const [r, s] of Object.entries(v)) {
          if (!isSkinCheckRuleId(r)) errs.push(`unknown rule ${r}`);
          else if (typeof s !== 'string' || !OVERRIDES.includes(s as SkinCheckSeverityOverride)) errs.push(`rules.${r} must be error | warning | info | off`);
        }
        continue;
      }
      const f = FIELD_BY_KEY[key];
      if (f) {
        if (seen.has(key)) errs.push(`${key} given twice`);
        seen.add(key);
        const c = coerceSetting(f, v);
        if (c === null) errs.push(`${key} must be a ${f.kind}`);
        else if (typeof c === 'number' && c !== clamp(f, c)) errs.push(`${key} must be between ${f.min} and ${f.max}`);
        continue;
      }
      if (isObj(v) && SKIN_CHECK_SETTING_FIELDS.some((x) => x.key.startsWith(`${key}.`))) { visit(v, key); continue; }
      errs.push(`unknown setting ${key}`);
    }
  };
  visit(raw, '');
  return errs;
}

/** One write by dotted key (CLI `settings set`, voice, MCP). Returns the new document or the error. */
export function setSetting(settings: SkinCheckSettings, key: string, value: unknown): { settings: SkinCheckSettings; error?: undefined } | { settings?: undefined; error: string } {
  if (key.startsWith('rules.')) {
    const errs = settingsErrors({ rules: { [key.slice(6)]: value } });
    if (errs.length) return { error: errs[0]! };
    return { settings: normalizeSettings({ ...flattenSettings(settings), rules: { ...settings.rules, [key.slice(6)]: value } }) };
  }
  const errs = settingsErrors({ [key]: value });
  if (errs.length) return { error: errs[0]! };
  return { settings: normalizeSettings({ ...flattenSettings(settings), rules: settings.rules, [key]: value }) };
}

/** Dotted key → value for every field (what `axf skin settings` prints and the panel binds to). */
export function flattenSettings(settings: SkinCheckSettings): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const f of SKIN_CHECK_SETTING_FIELDS) out[f.key] = getPath(settings, f.key) as number | boolean;
  return out;
}

/** Keys whose value differs from the default (what the panel marks as changed and `reset` clears). */
export function changedSettings(settings: SkinCheckSettings): string[] {
  const flat = flattenSettings(settings);
  const keys = SKIN_CHECK_SETTING_FIELDS.filter((f) => flat[f.key] !== f.default).map((f) => f.key);
  for (const r of Object.keys(settings.rules)) keys.push(`rules.${r}`);
  return keys;
}

/** The effective severity of a rule under these settings; `off` = do not run it. */
export function ruleSeverity(settings: SkinCheckSettings, rule: SkinCheckRuleId): SkinCheckSeverityOverride {
  return settings.rules[rule] ?? SKIN_CHECK_RULES.find((r) => r.id === rule)!.severity;
}

/** JSON schema (draft 2020-12) of the nested document, generated from the field table so the two never drift. */
export function settingsJsonSchema(): Record<string, unknown> {
  const props: Record<string, unknown> = { $axf: { const: SKIN_CHECK_SETTINGS_FRAME } };
  for (const f of SKIN_CHECK_SETTING_FIELDS) {
    const schema: Record<string, unknown> = f.kind === 'boolean'
      ? { type: 'boolean', default: f.default, description: f.hint }
      : { type: 'number', default: f.default, minimum: f.min, maximum: f.max, description: f.hint };
    const [group, leaf] = f.key.includes('.') ? f.key.split('.') as [string, string] : [null, f.key];
    if (!group) { props[leaf] = schema; continue; }
    const g = (props[group] ??= { type: 'object', additionalProperties: false, properties: {} }) as { properties: Record<string, unknown> };
    g.properties[leaf] = schema;
  }
  props.rules = {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(SKIN_CHECK_RULES.map((r) => [r.id, { enum: [...OVERRIDES], description: r.title }])),
  };
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'axf/skin-check-settings.schema.json', title: 'AmberX AXF skin checker settings', type: 'object', additionalProperties: false, properties: props };
}

/** Groups for the settings section of the checker panel: label, fields, and the rules whose severity it can set. */
export function settingsGroups(): { id: SkinCheckSettingGroup; label: string; fields: SkinCheckSettingField[]; rules: SkinCheckRuleId[] }[] {
  return SKIN_CHECK_SETTING_GROUPS.map((id) => ({
    id,
    label: SKIN_CHECK_SETTING_GROUP_LABEL[id],
    fields: settingFields(id),
    rules: SKIN_CHECK_RULES.filter((r) => r.category === id).map((r) => r.id),
  }));
}
