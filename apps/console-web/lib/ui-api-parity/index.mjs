/**
 * ui-api@1 declarations as control-registry@1 contributions (build full-api-cli-control-of-everything-plus-an-offli,
 * Nov 10 2026). A plugin's plugin.json `ui` block (build ui-api-parity-rule, PR #393) says, per view or dialog, which
 * refs read its state and which ref each control runs. Nothing in that block changes: this reads it as it is and turns
 * it into the page entry's `state.read` and `actions`, with `uiOnly` controls as gaps. Pure: hand in a manifest.
 *
 *   ui: { $axf: 'ui-api@1', views: { <view id>: { files?, state?: [ref…], actions?: { <label>: ref | [ref…] }, uiOnly?: { <label>: why }, note? } } }
 *   ref: <plugin>/<command> · action:<console action> · value:<setting key> · view:<id> · dialog:<id> · settings:<tab id>
 */
import { REF } from '../../../../framework/core/engines/control-registry.mjs';

export const UI_API_FRAME = 'ui-api@1';
const DESTRUCTIVE = /(^|[.:_/-])(delete|remove|reset|restore|clear|wipe|purge|uninstall|discard|drop|kill|destroy|revoke|rollback)([.:_/-]|$)/i;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A control label as an action id: "Open Plan Studio" → open-plan-studio. */
export const actionSlug = (label) => String(label ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'control';

/** What running a ref does, when the ref alone says it: opening things navigates, values write, deletes destroy; a plugin command asks `commands` (folder/id → effect). */
export function effectOfRef(ref, commands = new Map()) {
  const r = String(ref ?? '');
  if (/^(view|dialog|settings):/.test(r)) return 'navigate';
  if (r.startsWith('value:')) return 'write';
  if (r.startsWith('action:')) return DESTRUCTIVE.test(r) ? 'destructive' : /(^|[.:])(open|show|nav|settings|focus|help|search|view|toggle)([.:]|$)/i.test(r.slice(7)) ? 'navigate' : 'write';
  const c = commands.get(r.replace(/^[a-z0-9-]+:/, ''));
  if (c) return c.effect ?? (c.kind === 'read' ? 'read' : 'write');
  return DESTRUCTIVE.test(r) ? 'destructive' : 'write';
}

/**
 * The ui-api@1 block of a manifest, cleaned → { views: { id: { state: [ref], actions: [{ label, refs }], uiOnly: [{ label, why }] } }, errors }.
 * A ref that isn't one is reported and dropped, never guessed.
 */
export function readUiApi(manifest, { file = 'plugin.json' } = {}) {
  const errors = [];
  const ui = isObj(manifest) ? manifest.ui : undefined;
  if (ui === undefined) return { views: {}, errors, declared: false };
  if (!isObj(ui) || ui.$axf !== UI_API_FRAME) return { views: {}, errors: [`${file}: ui.$axf must be ${UI_API_FRAME}`], declared: true };
  const views = {};
  for (const [id, raw] of Object.entries(isObj(ui.views) ? ui.views : {})) {
    const v = isObj(raw) ? raw : {};
    const okRef = (r, where) => { const s = String(r ?? '').trim(); if (REF.test(s)) return s; errors.push(`${file}: ui.views.${id}.${where}: "${s.slice(0, 80)}" is not a ref`); return ''; };
    const state = (Array.isArray(v.state) ? v.state : []).map((r) => okRef(r, 'state')).filter(Boolean);
    const actions = Object.entries(isObj(v.actions) ? v.actions : {}).map(([label, r]) => ({ label, refs: (Array.isArray(r) ? r : [r]).map((x) => okRef(x, `actions["${label}"]`)).filter(Boolean) })).filter((a) => a.refs.length);
    const uiOnly = Object.entries(isObj(v.uiOnly) ? v.uiOnly : {}).map(([label, why]) => ({ label, why: String(why ?? '') }));
    views[id] = { state, actions, uiOnly, ...(v.note ? { note: String(v.note) } : {}), files: Array.isArray(v.files) ? v.files.map(String) : [] };
  }
  return { views, errors, declared: true };
}

/**
 * Apply a plugin's ui-api@1 views to its page entries (by view / dialog id): state.read, actions (label → ref, effect
 * from the ref or the plugin's commands), uiOnly → gaps. Entries not declared stay as they are. → { entries, errors }.
 */
export function applyUiApi(entries, manifest, { app = 'console-web', folder = '', commands = new Map(), file = 'plugin.json' } = {}) {
  const { views, errors } = readUiApi(manifest, { file });
  if (!Object.keys(views).length) return { entries, errors };
  const out = entries.map((e) => {
    const vid = e.type === 'page' && e.where?.app === app && (!folder || e.where.plugin === folder) ? (e.where.view ?? e.where.dialog ?? '') : '';
    const v = vid ? views[vid] : null;
    if (!v) return e;
    const next = { ...e, actions: [...(e.actions ?? [])], gaps: [...(e.gaps ?? [])], source: { ...e.source, frame: UI_API_FRAME } };
    if (v.state.length && !next.state?.read) next.state = { ...(next.state ?? {}), read: v.state[0], ...(v.state.length > 1 ? { shape: `also: ${v.state.slice(1).join(' · ')}` } : {}) };
    for (const a of v.actions) {
      const id = actionSlug(a.label);
      if (next.actions.some((x) => x.id === id)) continue;
      const run = a.refs[0];
      next.actions.push({ id, label: a.label, effect: effectOfRef(run, commands), run, ...(a.refs.length > 1 ? { description: `also runs ${a.refs.slice(1).join(', ')}` } : {}) });
    }
    for (const u of v.uiOnly) if (!next.gaps.some((g) => g.what === `control:${u.label}`)) next.gaps.push({ what: `control:${u.label}`, why: u.why.length >= 8 ? u.why : `UI only: ${u.why || 'no reason given'}` });
    return next;
  });
  return { entries: out, errors };
}
