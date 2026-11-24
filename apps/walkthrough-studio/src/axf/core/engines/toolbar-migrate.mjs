/**
 * toolbar migration — old toolbar assets (bare button lists for the app frame) onto the page-toolbar@1 shape
 * (core/engines/toolbar-rules.mjs) with no visible change. Build rebuild-every-toolbar-page-specific (s3).
 *
 * What moves:
 *   - `data.scope` is set to `app` when missing (the frame toolbar is what every old asset was);
 *   - `data.overflow` is set to the default rule when missing (`auto`: lowest priority folds into More);
 *   - every item's `badge` becomes its canonical ref (`alerts.unread` → `counter:alerts.unread`);
 *   - every item's `action` is trimmed; a bare id stays a bare id (it is a console action in both shapes);
 *   - a group with only a provider gets an empty `items` list.
 * Nothing else changes: ids, icons, labels, actions, checked bindings, requires, widgets, search and look are kept
 * as they are, so the toolbar draws the same before and after. `toolbarSignature` is what "the same" means: the
 * visible buttons with their targets; both validators refuse a migration whose signature differs from the original.
 *
 * Pure: no I/O. The migration runs where an asset is read (the engine, the validators), never rewrites files by itself;
 * `axf validate` runs it on every toolbar asset and fails when the migrated asset is invalid or draws differently.
 */
import { PAGE_TOOLBAR_CONTRACT, TOOLBAR_DEFAULTS, isPageToolbar, parseActionRef, parseBadge, parseToolbarChecked, toolbarErrors } from './toolbar-rules.mjs';

export const TOOLBAR_MIGRATION = 'toolbar-list@1 → page-toolbar@1';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether a toolbar asset's data is still the old shape (no scope, no page-toolbar fields). */
export function needsToolbarMigration(data) {
  if (!isObj(data)) return false;
  if ('scope' in data && 'overflow' in data) return false;
  return true;
}

/** The canonical badge ref (`counter:<name>` / `state:<key>`), or the input when it cannot be parsed. */
export function canonicalBadge(badge) {
  const b = parseBadge(badge);
  return b ? `${b.kind}:${b.ref}` : badge;
}

/**
 * Migrate one toolbar asset (the whole asset@1 document or just its data). Returns { asset, data, changed, changes }
 * where `changes` says what moved, in words, for the validator's report and the differences report. Non-toolbar
 * assets and malformed data come back untouched with changed: false.
 */
export function migrateToolbar(input) {
  const whole = isObj(input) && isObj(input.data) && 'type' in input;
  const data = whole ? input.data : input;
  if (!isObj(data) || (whole && input.type !== 'toolbar')) return { asset: input, data, changed: false, changes: [] };
  const changes = [];
  const next = { ...data };
  if (!('scope' in next)) { next.scope = TOOLBAR_DEFAULTS.scope; changes.push(`scope: ${TOOLBAR_DEFAULTS.scope}`); }
  if (!('overflow' in next)) { next.overflow = { ...TOOLBAR_DEFAULTS.overflow }; changes.push(`overflow: ${TOOLBAR_DEFAULTS.overflow.when}`); }
  if (Array.isArray(next.groups)) {
    next.groups = next.groups.map((g, i) => {
      if (!isObj(g)) return g;
      const group = { ...g };
      if (!Array.isArray(group.items) && typeof group.provider === 'string') { group.items = []; changes.push(`groups[${i}].items: []`); }
      if (Array.isArray(group.items)) {
        group.items = group.items.map((it, j) => {
          if (!isObj(it)) return it;
          const item = { ...it };
          if (typeof item.action === 'string' && item.action !== item.action.trim()) { item.action = item.action.trim(); changes.push(`groups[${i}].items[${j}].action trimmed`); }
          if (typeof item.badge === 'string' && item.badge) {
            const c = canonicalBadge(item.badge);
            if (c !== item.badge) { item.badge = c; changes.push(`groups[${i}].items[${j}].badge: ${c}`); }
          }
          return item;
        });
      }
      return group;
    });
  }
  const changed = changes.length > 0;
  const asset = whole ? { ...input, data: next } : next;
  return { asset, data: next, changed, changes };
}

/**
 * What a toolbar draws, independent of shape: every group with its visible buttons (id, icon, label, the resolved
 * action ref, badge ref, checked ref, requires) plus the provider lists, widgets, search and look. Equal signatures
 * before and after a migration mean no visible change.
 */
export function toolbarSignature(data) {
  if (!isObj(data)) return null;
  const refOf = (a) => { const r = parseActionRef(a); return r ? `${r.kind}:${r.id}` : null; };
  const badgeOf = (b) => { const p = parseBadge(b); return p ? `${p.kind}:${p.ref}` : null; };
  const checkedOf = (c) => { const p = parseToolbarChecked(c); return p ? `${p.kind}:${p.ref}` : null; };
  return {
    variant: data.variant, align: data.align, showSearch: data.showSearch, density: data.density ?? 'regular', surface: data.surface ?? 'flat', divider: data.divider ?? true,
    collapsible: data.collapsible ?? false, search: data.search ?? null, widgets: data.widgets ?? [],
    groups: (Array.isArray(data.groups) ? data.groups : []).map((g) => (isObj(g) ? {
      id: g.id, label: g.label ?? null, provider: g.provider ?? null, max: g.max ?? null,
      items: (Array.isArray(g.items) ? g.items : []).map((it) => (isObj(it) ? { id: it.id, icon: it.icon ?? null, label: it.label ?? null, action: refOf(it.action), badge: badgeOf(it.badge), checked: checkedOf(it.checked), requires: it.requires ?? null } : it)),
    } : g)),
  };
}

/**
 * Validator hook (both validators call it for every toolbar asset): the migrated asset must be valid under the
 * page-toolbar rules and draw exactly what the original drew. Returns error messages (empty when fine).
 */
export function toolbarMigrationErrors(type, data) {
  if (type !== 'toolbar' || !isObj(data) || !Array.isArray(data.groups)) return [];
  const { data: next } = migrateToolbar(data);
  const errors = toolbarErrors(type, next).map((e) => `after migration (${TOOLBAR_MIGRATION}): ${e}`);
  if (JSON.stringify(toolbarSignature(data)) !== JSON.stringify(toolbarSignature(next))) errors.push(`migration (${TOOLBAR_MIGRATION}) would change what the toolbar draws`);
  return errors;
}

/** A short record of one asset's migration for reports: id, whether it was the old shape, what moved. */
export function toolbarMigrationRecord(asset) {
  const r = migrateToolbar(asset);
  return { id: asset?.id ?? null, contract: PAGE_TOOLBAR_CONTRACT, wasOldShape: !isPageToolbar(asset?.data), changed: r.changed, changes: r.changes, sameLook: JSON.stringify(toolbarSignature(asset?.data)) === JSON.stringify(toolbarSignature(r.data)) };
}
