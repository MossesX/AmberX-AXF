/**
 * Level editor (Brett, Oct 28 2026): a dialog opened from the settings level toolbar. Left, a sortable, categorized
 * tree of every setting in the interface (tab → group / panel → setting), each coloured by whether the selected level
 * shows it; multi-select; toolbar buttons or right-click add the selection to the level's visible set or take it out.
 * Right, the tree of what the level has. Every move saves at once through the normal settings path
 * (SETTINGS_VISIBLE_KEY: last save wins, per key) so the settings page behind the dialog changes live, and the editor
 * re-reads on focus (useEditorSync). Administrator shows everything and can't be edited.
 *
 * Pure decisions (what a level shows, the smallest change to save) live in core/engines/settingsui.ts.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { arrangeSettingsTabs, normalizeSettingsUi, SETTINGS_LEVEL_ALL, SETTINGS_LEVEL_HINT, SETTINGS_LEVEL_KEY, SETTINGS_LEVEL_LABEL, SETTINGS_LEVELS, SETTINGS_VISIBLE_KEY, setSettingsVisible, settingShownAtLevel, settingsItemLevel, settingsLevel, settingsShown, shownAtLevel, withSettingsVisible, type SettingsLevel, type SettingsUi, type SettingValue } from '../../core';
import { Button, Checkbox, Icon, Segmented, useAxfState, useEditorSync, useRuntime } from '../../react';

export const LEVEL_EDITOR_DIALOG = 'axf.settings.levels';
/** Context-menu target of the editor's trees: Add to visible / Remove act on the selection. */
export const LEVEL_EDITOR_CTX = 'axf-settings-leveleditor';
export const LEVEL_EDITOR_ACTIONS = { add: 'settings.levels.add', remove: 'settings.levels.remove', open: 'settings.levels.edit' } as const;

/** The open editor's selection, for the context-menu actions (one editor at a time). */
let current: { add: () => void; remove: () => void } | null = null;
export const levelEditorAct = (what: 'add' | 'remove'): void => { current?.[what](); };

type NodeKind = 'tab' | 'group' | 'panel' | 'setting';
interface Node { id: string; kind: NodeKind; label: string; icon?: string; level: SettingsLevel; on: boolean; order: number; children: Node[] }
type Sort = 'order' | 'name' | 'level';

function useSettingValue(key: string): SettingValue {
  const rt = useRuntime();
  const sub = useMemo(() => (fn: () => void) => rt.settings.onChange(key, fn), [rt, key]);
  return useSyncExternalStore(sub, () => rt.settings.get(key), () => rt.settings.get(key));
}

/** The whole interface as a tree at a level: every tab the asset keeps (whatever its level), its groups and panels, their settings. */
function buildTree(rt: ReturnType<typeof useRuntime>, ui: SettingsUi, at: SettingsLevel): Node[] {
  const tabs = arrangeSettingsTabs(rt.settings.listTabs(), ui);
  return tabs.map((t, ti): Node => {
    const groups = rt.settings.groupsIn(t.id).filter((g) => settingsShown(ui, g.id)).map((g, gi): Node => {
      const own = (g as { level?: string }).level;
      const on = shownAtLevel(ui, g.id, at, own);
      return {
        id: g.id, kind: 'group', label: g.label, icon: g.icon ?? 'settings', level: settingsItemLevel(ui, g.id, own), on, order: g.order ?? 100 + gi,
        children: g.settings.filter((s) => s.kind !== 'section' && settingsShown(ui, s.key)).map((s, si): Node => ({
          id: s.key, kind: 'setting', label: s.label, icon: s.icon, level: ui.levelOf[s.key] ?? settingsItemLevel(ui, g.id, own), on: settingShownAtLevel(ui, s.key, at, on), order: si, children: [],
        })),
      };
    });
    const panels = rt.settings.panelsIn(t.id).filter((p) => settingsShown(ui, p.id)).map((p, pi): Node => ({ id: p.id, kind: 'panel', label: p.title, icon: p.icon ?? 'layout', level: settingsItemLevel(ui, p.id), on: shownAtLevel(ui, p.id, at), order: p.order ?? 100 + pi, children: [] }));
    return { id: t.id, kind: 'tab', label: t.label, icon: t.icon, level: settingsItemLevel(ui, t.id), on: shownAtLevel(ui, t.id, at), order: ti, children: [...groups, ...panels] };
  }).filter((t) => t.children.length > 0);
}

const sortNodes = (nodes: Node[], by: Sort): Node[] => [...nodes]
  .sort((a, b) => (by === 'name' ? a.label.localeCompare(b.label) : by === 'level' ? SETTINGS_LEVELS.indexOf(a.level) - SETTINGS_LEVELS.indexOf(b.level) || a.order - b.order : a.order - b.order))
  .map((n) => ({ ...n, children: sortNodes(n.children, by) }));

/** The tree cut to what the level shows (a parent stays when any child is on). */
const onlyOn = (nodes: Node[]): Node[] => nodes
  .map((n) => ({ ...n, children: onlyOn(n.children) }))
  .filter((n) => n.on || n.children.length > 0);

const walk = (nodes: Node[], fn: (n: Node, parents: Node[]) => void, parents: Node[] = []): void => nodes.forEach((n) => { fn(n, parents); walk(n.children, fn, [...parents, n]); });

export function LevelEditor() {
  const rt = useRuntime();
  useAxfState();
  useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision);
  const asset = rt.assetOrNull('settings');
  const base = useMemo(() => normalizeSettingsUi(asset?.data), [asset]);
  const stored = useSettingValue(SETTINGS_VISIBLE_KEY);
  const ui = useMemo(() => withSettingsVisible(base, stored), [base, stored]);
  const level = settingsLevel(ui, useSettingValue(SETTINGS_LEVEL_KEY));
  const [sort, setSort] = useState<Sort>('order');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  // Fresh on focus (UI-editing rule): re-read saved values whenever the dialog opens or the window comes back.
  useEditorSync();

  const tree = useMemo(() => sortNodes(buildTree(rt, ui, level), sort), [rt, ui, level, sort]);
  const byId = useMemo(() => { const m = new Map<string, { node: Node; parents: Node[] }>(); walk(tree, (n, p) => m.set(n.id, { node: n, parents: p })); return m; }, [tree]);
  const all = level === SETTINGS_LEVEL_ALL;
  const picked = [...selected].filter((id) => byId.has(id));

  /** Save one move for the selection: adding an item also adds the parents it needs; removing a group removes its settings too. */
  const move = (visible: boolean, which: string[] = picked) => {
    if (all || !which.length) return;
    const ids = new Set<string>();
    which.forEach((id) => {
      const e = byId.get(id)!;
      ids.add(id);
      if (visible) e.parents.filter((p) => !p.on).forEach((p) => ids.add(p.id));
      else walk(e.node.children, (c) => ids.add(c.id));
    });
    const levelOfId = (id: string) => byId.get(id)?.node.level ?? settingsItemLevel(base, id);
    rt.settings.set(SETTINGS_VISIBLE_KEY, JSON.stringify(setSettingsVisible(base, rt.settings.get(SETTINGS_VISIBLE_KEY), level, [...ids], visible, levelOfId)));
  };
  current = { add: () => move(true), remove: () => move(false) };

  const toggle = (n: Node, withChildren: boolean) => setSelected((s) => {
    const next = new Set(s);
    const on = !next.has(n.id);
    const apply = (x: Node) => { if (on) next.add(x.id); else next.delete(x.id); };
    apply(n);
    if (withChildren) walk(n.children, apply);
    return next;
  });
  const fold = (id: string) => setFolded((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const reset = () => rt.settings.set(SETTINGS_VISIBLE_KEY, '');
  const hasOwn = Object.keys(ui.visible).length > 0 && stored !== '' && stored !== null;

  const row = (n: Node, depth: number, side: 'all' | 'on'): ReactNode => {
    const isOpen = !folded.has(`${side}:${n.id}`);
    return (
      <li key={n.id} className={`axf-levels__node axf-levels__node--${n.kind} ${n.on ? 'is-on' : 'is-off'} ${selected.has(n.id) ? 'is-selected' : ''}`} data-fx-ctx-payload={n.id} style={{ ['--axf-depth' as string]: depth }}>
        <div className="axf-levels__row" onDoubleClick={() => { if (!all) { setSelected(new Set([n.id])); move(!n.on, [n.id]); } }} onContextMenu={() => { if (!selected.has(n.id)) toggle(n, n.kind !== 'setting'); }}>
          {n.children.length > 0 && depth === 0 && side === 'all' ? (
            <button type="button" className="fx-iconbtn axf-levels__fold" aria-expanded={isOpen} aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={() => fold(`${side}:${n.id}`)}><Icon name="chevron-down" size={13} className={isOpen ? '' : 'fx-rot--90'} /></button>
          ) : <span className="axf-levels__fold" />}
          <Checkbox label={<span className="axf-levels__label"><Icon name={n.icon ?? (n.kind === 'setting' ? 'sliders' : 'folder')} size={13} /><span>{n.label}</span></span>} checked={selected.has(n.id)} onChange={() => toggle(n, n.kind !== 'setting')} disabled={all} className="axf-levels__check" />
          <span className={`fx-chip axf-levels__state ${n.on ? 'fx-chip--success' : ''}`} title={n.on ? `Shown at ${SETTINGS_LEVEL_LABEL[level]}` : `Not at ${SETTINGS_LEVEL_LABEL[level]} (its level is ${SETTINGS_LEVEL_LABEL[n.level]})`}>{n.on ? 'on' : SETTINGS_LEVEL_LABEL[n.level]}</span>
        </div>
        {n.children.length > 0 && isOpen && <ul className="axf-levels__list">{n.children.map((c) => row(c, depth + 1, side))}</ul>}
      </li>
    );
  };
  const onTree = onlyOn(tree);
  const count = (nodes: Node[]) => { let c = 0; walk(nodes, (n) => { if (n.kind === 'setting' || (n.kind === 'panel')) c += n.on ? 1 : 0; }); return c; };
  const total = (nodes: Node[]) => { let c = 0; walk(nodes, (n) => { if (n.kind === 'setting' || n.kind === 'panel') c += 1; }); return c; };

  return (
    <div className="axf-levels fx-stack" data-axf-anchor="settings-levels-editor">
      <div className="axf-levels__bar" role="toolbar" aria-label="Level editor">
        <Segmented label="Level" value={level} onChange={(l) => rt.settings.set(SETTINGS_LEVEL_KEY, l)} options={SETTINGS_LEVELS.map((l) => ({ value: l, label: SETTINGS_LEVEL_LABEL[l], title: SETTINGS_LEVEL_HINT[l] }))} />
        <Segmented label="Sort" size="sm" value={sort} onChange={setSort} options={[{ value: 'order', label: 'Interface order' }, { value: 'name', label: 'A–Z' }, { value: 'level', label: 'By level' }]} />
        <span className="axf-levels__bar-actions">
          <Button size="sm" tone="primary" icon="plus" disabled={all || !picked.length} onClick={() => move(true)}>Add to visible</Button>
          <Button size="sm" icon="minus" disabled={all || !picked.length} onClick={() => move(false)}>Remove</Button>
          <Button size="sm" tone="quiet" icon="undo" disabled={!hasOwn} onClick={reset} title="Forget your own changes to every level; the interface's own sets stay">Reset mine</Button>
        </span>
      </div>
      <p className="fx-muted axf-levels__hint" style={{ margin: 0 }}>
        {all ? 'Administrator shows every setting; pick another level to change what it shows.' : `Tick settings, groups or whole tabs, then Add to visible or Remove (or right-click them). Double-click flips one. ${count(tree)} of ${total(tree)} on at ${SETTINGS_LEVEL_LABEL[level]}; the settings page changes as you go.`}
      </p>
      <div className="axf-levels__cols">
        <section className="axf-levels__col" aria-label="Every setting" data-fx-ctx-target={LEVEL_EDITOR_CTX}>
          <h3 className="axf-levels__title"><Icon name="list" size={14} /> Every setting <span className="fx-muted">({SETTINGS_LEVEL_LABEL[level]}: <span className="axf-levels__swatch is-on">shown</span> · <span className="axf-levels__swatch is-off">not shown</span>)</span></h3>
          <ul className="axf-levels__list axf-levels__tree">{tree.map((t) => row(t, 0, 'all'))}</ul>
        </section>
        <section className="axf-levels__col" aria-label={`Shown at ${SETTINGS_LEVEL_LABEL[level]}`} data-fx-ctx-target={LEVEL_EDITOR_CTX}>
          <h3 className="axf-levels__title"><Icon name="check" size={14} /> On at {SETTINGS_LEVEL_LABEL[level]}</h3>
          {onTree.length ? <ul className="axf-levels__list axf-levels__tree">{onTree.map((t) => row(t, 0, 'on'))}</ul> : <p className="fx-muted" style={{ margin: 0 }}>Nothing yet at this level.</p>}
        </section>
      </div>
    </div>
  );
}

export const LEVELS_CSS = `
.fx-dialog:has(.axf-levels){width:min(960px,100%)}
.axf-levels__bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--fx-dens-gap-md) var(--fx-dens-gap-xl)}
.axf-levels__bar>*{min-width:0}
.axf-levels__bar-actions{display:inline-flex;flex-wrap:wrap;gap:var(--fx-dens-gap-md);margin-left:auto}
.axf-levels__hint{font-size:var(--fx-type-scale-md)}
.axf-levels__cols{display:grid;grid-template-columns:1fr 1fr;gap:var(--fx-dens-gap-2xl);align-items:start}
.axf-levels__col{min-width:0;border:var(--fx-border-w) solid var(--fx-border);border-radius:var(--fx-radius-md);background:var(--fx-surface2);padding:var(--fx-dens-gap-xl);max-height:52dvh;overflow:auto}
.axf-levels__title{margin:0 0 var(--fx-dens-gap-lg);font-size:var(--fx-type-scale-md);display:flex;align-items:center;gap:var(--fx-dens-gap-md);flex-wrap:wrap}
.axf-levels__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--fx-dens-gap-xs)}
.axf-levels__node>.axf-levels__list{padding-left:var(--fx-dens-gap-2xl)}
.axf-levels__row{display:flex;align-items:center;gap:var(--fx-dens-gap-md);min-height:var(--fx-row-h);border-radius:var(--fx-radius-sm);padding:0 var(--fx-dens-gap-md)}
.axf-levels__row:hover{background:color-mix(in srgb, var(--fx-accent) calc(var(--fx-opacity-hover) * 100%), transparent)}
.axf-levels__node.is-selected>.axf-levels__row{background:color-mix(in srgb, var(--fx-accent) calc(var(--fx-opacity-tint) * 100%), transparent)}
.axf-levels__fold{flex:0 0 auto;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center}
.axf-levels__check{flex:1 1 auto;min-width:0;margin:0}
.axf-levels__label{display:inline-flex;align-items:center;gap:var(--fx-dens-gap-md);min-width:0}
.axf-levels__label>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.axf-levels__node.is-on>.axf-levels__row .axf-levels__label,.axf-levels__swatch.is-on{color:var(--fx-success)}
.axf-levels__node.is-off>.axf-levels__row .axf-levels__label,.axf-levels__swatch.is-off{color:var(--fx-muted)}
.axf-levels__node--tab>.axf-levels__row .axf-levels__label{font-weight:600}
.axf-levels__state{flex:0 0 auto;font-size:var(--fx-type-scale-xs)}
@media (max-width:640px){.axf-levels__cols{grid-template-columns:1fr}.axf-levels__col{max-height:34dvh}}
`;
