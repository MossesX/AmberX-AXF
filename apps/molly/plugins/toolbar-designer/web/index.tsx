import { useMemo, useState } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import type { UnifiedChrome, UnifiedMenuItem } from '../../../src/axf/core/engines/chrome';
import { OPEN_TARGETS, TOOLBAR_SLOT_COUNT, type OpenTarget, type XLayoutData, type XToolbarItem } from '../../../src/axf/core/engines/xlayout';
import { Button, Icon, IconButton, SelectField, TextField, useRuntime } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { mollyService, provideMollyService } from '../../../src/molly/host';
import helpPack from '../help.json';
import './designer.css';

/**
 * Toolbar designer (Molly plugin, its own folder): pick what a toolbar holds from every plugin and screen (Molly's
 * pages and actions, and each app's navigation, menus and toolbars), and where each item opens (the main area, a
 * floating window, or a pane while IDE mode is on). Others reach it only through its capability,
 * `axf.toolbar-designer@1` (`open({ plugin, screen, slot })`); it reads and saves through xLayout's, `axf.xlayout@1`.
 * Either can be removed: without xLayout it says so, without it xLayout's Customize says to install it.
 */

export const PLUGIN_ID = 'ai.amberx.axf.molly.toolbar-designer';
export const DIALOG = 'toolbar-designer';
const CAPABILITY = 'axf.toolbar-designer@1';
const XLAYOUT = 'axf.xlayout@1';

/** What this plugin needs from xLayout (its capability; declared here, never imported from its folder). */
interface XLayoutService {
  layout(): XLayoutData;
  chrome(): UnifiedChrome;
  saveSlot(slot: number, items: XToolbarItem[]): void;
  run(item: XToolbarItem): void;
}

interface Choice { key: string; label: string; icon: string; app?: string; action: string; where: string }
interface Group { id: string; label: string; items: Choice[] }

const OPEN_LABEL: Record<OpenTarget, string> = { main: 'Main area', floating: 'Floating window', pane: 'Pane (IDE mode)' };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

/** Everything a toolbar can hold: Molly's own pages and actions, then each app's navigation, menus and toolbars. */
function catalogue(rt: AxfRuntime, x: XLayoutService | null): Group[] {
  const groups: Group[] = [];
  const nav = (rt.assetOrNull('nav-menu') as { data?: { sections?: { label?: string | null; items: { id: string; label: string; icon: string; view: string }[] }[] } } | null)?.data?.sections ?? [];
  const pages: Choice[] = nav.flatMap((s) => s.items).filter((i) => !i.view.includes('/')).map((i) => ({ key: `nav:${i.view}`, label: i.label, icon: i.icon, action: `nav:${i.view}`, where: 'Page' }));
  const actions: Choice[] = rt.actions.list().filter((a) => a.meta.label && !a.id.startsWith('xlayout.run') && !a.meta.requires).map((a) => ({ key: a.id, label: a.meta.label!, icon: 'zap', action: a.id, where: a.meta.module ? `Action · ${a.meta.module.split('.').pop()}` : 'Action' }));
  groups.push({ id: 'molly', label: 'Molly', items: [...pages, ...actions] });
  if (!x) return groups;
  const u = x.chrome();
  for (const app of x.layout().apps) {
    const items: Choice[] = [];
    const seen = new Set<string>();
    const add = (c: Choice) => { if (!seen.has(c.key)) { seen.add(c.key); items.push(c); } };
    for (const s of u.nav) if (s.app === app.id) for (const i of s.items) add({ key: i.id, label: i.label, icon: i.icon ?? 'box', app: app.id, action: i.id, where: 'Page' });
    const walk = (list: UnifiedMenuItem[], path: string) => { for (const i of list) { if (i.separator) continue; if (i.items?.length) walk(i.items, path ? `${path} › ${i.label}` : i.label); else if (!i.locked) add({ key: i.id, label: i.label, icon: i.icon ?? 'box', app: app.id, action: i.id, where: path ? `Menu · ${path}` : 'Menu' }); } };
    for (const m of u.menus) if (m.app === app.id) walk(m.items, '');
    for (const t of u.toolbars) if (t.app === app.id) for (const i of t.items) if (!i.locked) add({ key: i.id, label: i.label, icon: i.icon, app: app.id, action: i.id, where: `Toolbar${t.label ? ` · ${t.label}` : ''}` });
    groups.push({ id: app.id, label: app.label, items });
  }
  return groups;
}

function Designer({ slot: slot0, close }: { slot: number; close: () => void }) {
  const rt = useRuntime();
  const x = mollyService<XLayoutService>(XLAYOUT);
  const [slot, setSlot] = useState(Math.min(Math.max(slot0, 1), TOOLBAR_SLOT_COUNT));
  const layout = x?.layout();
  const [items, setItems] = useState<XToolbarItem[]>(() => layout?.toolbars.find((t) => t.slot === slot)?.items ?? []);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => catalogue(rt, x), [rt, x]);
  if (!x || !layout) return <p className="fx-muted"><Icon name="info" /> The Toolbar designer saves into xLayout's toolbars. Install the xLayout plugin first.</p>;
  const ide = layout.ide.on;
  const pickSlot = (n: number) => { setSlot(n); setItems(layout.toolbars.find((t) => t.slot === n)?.items ?? []); };
  const q = query.trim().toLowerCase();
  const has = new Set(items.map((i) => i.action + (i.app ?? '')));
  const add = (c: Choice) => {
    let id = slug(`${c.app ?? 'molly'}-${c.label}`); let n = 2;
    while (items.some((i) => i.id === id)) id = `${slug(`${c.app ?? 'molly'}-${c.label}`)}-${n++}`;
    const it: XToolbarItem = { id, label: c.label, icon: c.icon, action: c.action, open: 'main' };
    if (c.app) it.app = c.app;
    setItems((l) => [...l, it]);
  };
  const move = (i: number, d: number) => setItems((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const set = (i: number, patch: Partial<XToolbarItem>) => setItems((l) => l.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const appLabel = (id?: string) => (id ? layout.apps.find((a) => a.id === id)?.label ?? id : 'Molly');
  return (
    <div className="fx-form axp-toolbar-designer">
      <div className="axp-toolbar-designer__head">
        <SelectField label="Toolbar" value={String(slot)} options={layout.toolbars.map((t) => ({ value: String(t.slot), label: `${t.label} (toolbar ${t.slot})${t.visible ? '' : ', hidden'}` }))} onChange={(v) => pickSlot(Number(v))} />
        <TextField label="Find" value={query} onChange={setQuery} />
      </div>
      <div className="axp-toolbar-designer__cols">
        <section className="axp-toolbar-designer__col" aria-label="Items you can add" data-fx-ctx-ignore>
          <h3 className="fx-eyebrow">Every plugin and screen</h3>
          {groups.map((g) => {
            const shown = g.items.filter((c) => !q || c.label.toLowerCase().includes(q) || c.where.toLowerCase().includes(q));
            if (!shown.length) return null;
            return (
              <details key={g.id} className="axp-toolbar-designer__group" open={!!q || g.id === 'molly'}>
                <summary>{g.label} <span className="fx-muted">({shown.length})</span></summary>
                <ul className="axp-toolbar-designer__list">
                  {shown.map((c) => (
                    <li key={c.key} className="axp-toolbar-designer__row">
                      <Icon name={c.icon} /><span className="axp-toolbar-designer__label">{c.label}<span className="fx-muted"> · {c.where}</span></span>
                      <IconButton icon="plus" label={`Add ${c.label}`} disabled={has.has(c.action + (c.app ?? ''))} onClick={() => add(c)} />
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
          {groups.length === 1 && <p className="fx-muted">The apps' items show up here once their pages have been opened in Molly.</p>}
        </section>
        <section className="axp-toolbar-designer__col" aria-label="On this toolbar">
          <h3 className="fx-eyebrow">On this toolbar ({items.length})</h3>
          {!items.length && <p className="fx-muted">Nothing yet: add items from the left.</p>}
          <ul className="axp-toolbar-designer__list">
            {items.map((it, i) => (
              <li key={it.id} className="axp-toolbar-designer__row axp-toolbar-designer__row--on">
                <Icon name={it.icon ?? 'box'} />
                <span className="axp-toolbar-designer__label">{it.label}<span className="fx-muted"> · {appLabel(it.app)}</span></span>
                <SelectField label="Opens in" value={it.open} options={OPEN_TARGETS.map((o) => ({ value: o, label: o === 'pane' && !ide ? `${OPEN_LABEL[o]}, floats while it is off` : OPEN_LABEL[o] }))} onChange={(v) => set(i, { open: v as OpenTarget })} />
                <IconButton icon="chevron-up" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon="chevron-down" label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon="play" label="Try it" onClick={() => x.run(it)} />
                <IconButton icon="trash" label={`Remove ${it.label}`} onClick={() => setItems((l) => l.filter((_, k) => k !== i))} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="fx-form__actions">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="check" onClick={() => { x.saveSlot(slot, items); rt.toast(`${items.length} item${items.length === 1 ? '' : 's'} on toolbar ${slot}.`, 'success', 'Toolbar saved'); close(); }}>Save toolbar</Button>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const x = mollyService<XLayoutService>(XLAYOUT);
  return (
    <div className="fx-stack">
      <p className="fx-muted">Pick what each toolbar holds, from every app and screen, and where each item opens. Also from right-click on any toolbar → Customize toolbar.</p>
      <div className="fx-form__actions">
        {Array.from({ length: TOOLBAR_SLOT_COUNT }, (_, i) => i + 1).map((n) => <Button key={n} icon="edit" disabled={!x} onClick={() => rt.openDialog(DIALOG, { slot: n })}>Toolbar {n}…</Button>)}
      </div>
      {!x && <p className="fx-muted"><Icon name="info" /> Needs the xLayout plugin (it owns the toolbars).</p>}
      <pre className="axp-toolbar-designer__code">{'node apps/molly/plugins/toolbar-designer/install.mjs\nnode apps/molly/plugins/toolbar-designer/uninstall.mjs --all'}</pre>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Toolbar designer',
  version: '0.1.0',
  provides: [`service:${CAPABILITY}`, `dialog:${DIALOG}`, 'settings-tab:toolbar-designer'],
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    provideMollyService(PLUGIN_ID, CAPABILITY, { open: ({ slot }: { plugin: string; screen: string; slot: number }) => rt.openDialog(DIALOG, { slot }) });
    rt.actions.register('toolbar-designer.open', (args, ctx) => {
      const fromPayload = ctx.payload?.split('|')[2];
      rt.openDialog(DIALOG, { slot: Number(args[0] ?? fromPayload ?? 1) || 1 });
    }, { label: 'Toolbar designer…' });
  },
  dialogs: { [DIALOG]: { title: 'Toolbar designer', icon: 'hammer', render: (p, close) => <Designer slot={Number(p.slot ?? 1) || 1} close={close} /> } },
  settingsTabs: [{ id: 'toolbar-designer', label: 'Toolbar designer', icon: 'hammer', order: 45, parent: 'plugins', description: 'Pick what each toolbar holds and where its items open.' }],
  settingsPanels: [{ id: 'toolbar-designer.main', section: 'general', tab: 'toolbar-designer', title: 'Toolbars', icon: 'hammer', order: 10, render: () => <SettingsPanel /> }],
  appMenu: [{ id: 'toolbar-designer.view', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 30, items: [{ id: 'toolbar-designer.open', label: 'Toolbar designer…', icon: 'hammer', action: 'toolbar-designer.open:1' }] }],
  // right-click on any toolbar: Molly's own (asset toolbar) and the plugin toolbars
  contextMenu: [
    { id: 'toolbar-designer.toolbar', target: 'toolbar', items: [{ id: 'toolbar-designer.customize', label: 'Customize toolbar…', icon: 'hammer', action: 'toolbar-designer.open:1' }] },
  ],
};
