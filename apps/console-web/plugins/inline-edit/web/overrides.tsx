/**
 * The overrides list (`inline-edit-overrides`): every value changed from axHub's inheritance, in one place.
 *
 *   column   a multi-tab column, one root per tab (kept per user on the server); each tab shows the records under its
 *            root as a tree, and any node of that tree can be selected as the root
 *   list     the records under the selected root, with full-text search and filters (app, element type, token kind,
 *            scope, changed by, date), from → to, who and when, and Reset to axHub per item
 *   reset    restores only that item and updates the list at once; a parent-scope override asks first (it reaches every
 *            element under that parent)
 *
 * Everything here is server state (PUT overrides/state, POST overrides/tabs…), so the API, MCP, CLI and voice move this
 * page too: it re-reads every 5 s while visible and at once after any change made here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Chip, Container, Icon, IconButton, Note, SelectField, TabGroup, TextField, useRuntime } from '@console/axf/react';
import { addTab, errText, listOverrides, removeTab, resetItem, setOverridesState, CHANGED_EVENT, type Filter, type OverrideItem, type OverridesList, type TreeNode } from './api';
import { shown, swatchVar } from './editors';

export const VIEW = 'inline-edit-overrides';

const FILTER_FIELDS: { key: keyof Filter; label: string; facet: string }[] = [
  { key: 'app', label: 'App', facet: 'app' },
  { key: 'kind', label: 'Element type', facet: 'kind' },
  { key: 'tokenKind', label: 'Token kind', facet: 'tokenKind' },
  { key: 'scope', label: 'Scope', facet: 'scope' },
  { key: 'by', label: 'Changed by', facet: 'by' },
];

function TreeNodes({ nodes, selected, onSelect }: { nodes: TreeNode[]; selected: string; onSelect: (p: string) => void }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <ul role="group" className="axp-inline-edit__otree-group">
      {nodes.map((n) => {
        const open = !closed[n.path];
        return (
          <li key={n.path} role="treeitem" aria-expanded={n.children.length ? open : undefined} aria-selected={selected === n.path} className={`axp-inline-edit__onode ${selected === n.path ? 'is-selected' : ''}`}>
            <div className="axp-inline-edit__onode-head">
              {n.children.length ? <IconButton icon={open ? 'chevron-down' : 'chevron-right'} label={`${open ? 'Fold' : 'Open'} ${n.label}`} onClick={() => setClosed((c) => ({ ...c, [n.path]: open }))} /> : <span className="axp-inline-edit__leaf" aria-hidden="true" />}
              <Button size="sm" tone={selected === n.path ? 'primary' : 'quiet'} title={`Show only what is under ${n.path}`} onClick={() => onSelect(selected === n.path ? '' : n.path)}>{n.label}</Button>
              <span className="fx-muted">{n.count}</span>
            </div>
            {open && n.children.length > 0 && <TreeNodes nodes={n.children} selected={selected} onSelect={onSelect} />}
          </li>
        );
      })}
    </ul>
  );
}

function Value({ v, kind }: { v: OverrideItem['value']; kind: string }) {
  return <>{kind === 'color' && typeof v === 'string' && v !== 'theme' && <span className="axp-inline-edit__swatch axp-inline-edit__swatch--small" style={{ background: swatchVar(v) }} aria-hidden="true" />}<code>{shown(v)}</code></>;
}

function Row({ r, onReset, onEdit }: { r: OverrideItem; onReset: (r: OverrideItem) => Promise<void>; onEdit: (r: OverrideItem) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onReset(r); } finally { setBusy(false); setAsking(false); } };
  return (
    <li className="axp-inline-edit__orow" data-id={r.id}>
      <div className="axp-inline-edit__orow-main">
        <strong>{r.tokenLabel}</strong> <span className="fx-muted">on</span> <span>{r.label}</span> <Chip tone={r.scope === 'parent' ? 'accent' : undefined}>{r.scope === 'parent' ? 'parent: and everything under it' : 'this item'}</Chip>
        <div className="axp-inline-edit__orow-change"><span className="fx-muted">axHub</span> <Value v={r.axHubValue} kind={r.tokenKind} /> <Icon name="arrow-right" size={12} /> <Value v={r.value} kind={r.tokenKind} /></div>
        <div className="axp-inline-edit__orow-meta fx-muted"><code title="Element path">{r.path}</code> · {r.kindLabel} · {r.group} · {r.app === 'any' ? 'every app' : r.app} · {r.by || 'unknown'} · {r.at ? new Date(r.at).toLocaleString() : ''}{r.reason ? ` · ${r.reason}` : ''}</div>
      </div>
      <div className="axp-inline-edit__orow-actions">
        <Button size="sm" tone="quiet" icon="edit" onClick={() => onEdit(r)}>Edit</Button>
        {!asking && <Button size="sm" tone="ghost" icon="undo" busy={busy} onClick={() => (r.scope === 'parent' ? setAsking(true) : void go())}>Reset to axHub</Button>}
        {asking && (
          <span className="axp-inline-edit__confirm" role="alertdialog" aria-label="Reset a parent override?">
            <span>This reaches everything under {r.label}. Reset it?</span>
            <Button size="sm" tone="danger" busy={busy} onClick={() => void go()}>Reset</Button>
            <Button size="sm" tone="quiet" onClick={() => setAsking(false)}>Keep</Button>
          </span>
        )}
      </div>
    </li>
  );
}

export function OverridesPage() {
  const rt = useRuntime();
  const [d, setD] = useState<OverridesList | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const typing = useRef(0);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const x = await listOverrides(); // the user's saved state: root, q, filter, tab
      setD(x); setError('');
      if (Date.now() - typing.current > 2_000) setQ(x.q);
    } catch (e) { setError(errText(e)); }
  }, []);
  const save = useCallback(async (patch: Parameters<typeof setOverridesState>[0]) => {
    try { await setOverridesState(patch); } catch (e) { rt.toast(errText(e), 'danger', 'Inline edit'); }
    await load();
  }, [load, rt]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 5_000);
    const f = () => void load();
    globalThis.addEventListener(CHANGED_EVENT, f);
    return () => { clearInterval(t); globalThis.removeEventListener(CHANGED_EVENT, f); };
  }, [load]);

  const onQ = (v: string) => {
    setQ(v); typing.current = Date.now();
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => void save({ q: v }), 300);
  };
  const setFilter = (k: keyof Filter, v: string) => { const f = { ...(d?.filter ?? {}) }; if (v) f[k] = v; else delete f[k]; void save({ filter: f }); };
  const onReset = async (r: OverrideItem) => {
    try {
      const x = await resetItem(r.id);
      rt.toast(x.now, 'success', 'Reset to axHub');
      await load();
    } catch (e) { rt.toast(errText(e), 'danger', 'Inline edit'); }
  };
  const onEdit = (r: OverrideItem) => rt.dispatch(`inline-edit.element:${new URLSearchParams({ path: r.path, scope: r.scope }).toString()}`);

  if (!d) {
    return <div className="axp-inline-edit axp-inline-edit__page">{error ? <Note tone="danger" icon="alert">{error}</Note> : <p className="fx-muted">Loading overrides…</p>}</div>;
  }
  const tabs = d.tabs.map((t) => ({ value: t.id, label: t.label, icon: t.root ? 'folder' : 'layers', title: t.root || 'Everything', closable: d.tabs.length > 1 }));
  const facet = (k: string) => d.facets[k] ?? [];

  return (
    <div className="axp-inline-edit axp-inline-edit__page">
      <header className="axp-inline-edit__head">
        <h2 className="axp-inline-edit__title">Overrides</h2>
        <p className="fx-muted">Every value changed from axHub's inheritance: {d.total} in all, {d.shown} shown. Reset any one of them and only that item goes back to what it inherits from axHub.</p>
      </header>
      <div className="axp-inline-edit__columns">
        <aside className="axp-inline-edit__column" aria-label="Roots">
          <TabGroup id="inline-edit.overrides.tabs" label="Roots" value={d.tab} tabs={tabs}
            onChange={(v) => void save({ tab: v })}
            onClose={(v) => void removeTab(v).then(load).catch((e: unknown) => rt.toast(errText(e), 'danger', 'Inline edit'))}
            extra={<IconButton icon="plus" label="New tab with the selected root" onClick={() => void addTab(d.root).then(load).catch((e: unknown) => rt.toast(errText(e), 'danger', 'Inline edit'))} />}
          />
          <SelectField label="Root" value={d.root} empty="Everything" options={d.roots.map((r) => ({ value: r.path, label: `${'  '.repeat(r.depth - 1)}${r.path.split('/').at(-1)} (${r.count})` }))} onChange={(v) => void save({ root: v })} />
          <Container title="Tree" icon="folder">
            {d.tree.length ? <ul className="axp-inline-edit__otree" role="tree" aria-label="Overrides by element"><TreeNodes nodes={d.tree} selected={d.root} onSelect={(p) => void save({ root: p })} /></ul> : <p className="fx-muted">Nothing under this root.</p>}
          </Container>
        </aside>
        <section className="axp-inline-edit__list" aria-label="Overrides">
          <div className="axp-inline-edit__filters" role="toolbar" aria-label="Search and filters">
            <TextField label="Search" type="search" value={q} onChange={onQ} placeholder="element, token, value, who…" />
            {FILTER_FIELDS.map((f) => (
              <SelectField key={f.key} label={f.label} value={d.filter[f.key] ?? ''} empty="Any" options={facet(f.facet).map((x) => ({ value: x.value, label: `${x.value} (${x.count})` }))} onChange={(v) => setFilter(f.key, v)} />
            ))}
            <TextField label="Changed since" type="date" value={d.filter.since ?? ''} onChange={(v) => setFilter('since', v)} />
            <TextField label="Until" type="date" value={d.filter.until ?? ''} onChange={(v) => setFilter('until', v)} />
            {(Object.keys(d.filter).length > 0 || d.q) && <Button size="sm" tone="quiet" icon="x" onClick={() => { setQ(''); void save({ q: '', filter: {} }); }}>Clear</Button>}
          </div>
          {error && <Note tone="danger" icon="alert">{error}</Note>}
          {d.items.length === 0
            ? <Note tone="info" icon="info">{d.total ? 'Nothing matches the search and filters.' : 'Nothing is overridden: everything inherits from axHub. Turn on Inline edit mode and right-click an element to change it.'}</Note>
            : <ul className="axp-inline-edit__olist">{d.items.map((r) => <Row key={r.id} r={r} onReset={onReset} onEdit={onEdit} />)}</ul>}
        </section>
      </div>
    </div>
  );
}
