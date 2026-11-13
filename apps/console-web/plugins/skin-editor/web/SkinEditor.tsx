/*
 * Skin editor: pick any UI (a screen, dialog, plugin or element, from the list or by clicking it on screen) and it is
 * drawn inside a sandbox with real components. The sandbox wrapper carries the head snapshot's tokens as CSS custom
 * properties, so every edit hot-renders at once; the server keeps the chain (skin-snapshot@1), one snapshot per edit,
 * shown like disk snapshots; any point reverts (a new snapshot, nothing lost); any state exports as a new skin.
 * Inline element editing: click an element in the sandbox (Pick element) and the token list narrows to that element.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Button, Chip, ColorField, Container, Icon, IconButton, Note, Segmented, SelectField, Slider, Switch, TabGroup, TextField, useAxfState, useEditorSync, useRuntime } from '@console/axf/react';
import { ELEMENT_LABELS } from '@console/axf/core/engines/token-registry.mjs';
import * as api from './api';
import type { Session, UiListItem, UiPick } from './api';
import { ELEMENT_KEY, LEVELS, LEVEL_KEY, PANEL_KEY, UI_KEY, ago, baseFromActive, cssVars, elementOf, groupByElement, isColourToken, skinIdOf, visibleTokens, type RegistryToken, type TokenLevel } from './model';

const P = 'axp-skin';
type Panel = 'tokens' | 'history' | 'export';
const PANELS: { value: Panel; label: string; icon: string }[] = [{ value: 'tokens', label: 'Tokens', icon: 'sliders' }, { value: 'history', label: 'History', icon: 'clock' }, { value: 'export', label: 'Export', icon: 'download' }];

/** The gallery: real framework controls with sample data, one card per element type. */
function ElementGallery({ only }: { only?: string }) {
  const [seg, setSeg] = useState('day');
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState('open');
  const [n, setN] = useState(40);
  const show = (id: string) => !only || only === id;
  return (
    <div className={`${P}__gallery`}>
      {show('button') && <Container title="Buttons" icon="box"><div className={`${P}__wrap`}><Button tone="primary">Primary</Button><Button>Neutral</Button><Button tone="danger">Danger</Button><Button tone="success">Success</Button><Button tone="ghost">Ghost</Button><IconButton icon="settings" label="Settings" /><Button size="sm" icon="plus">Small</Button><Button disabled>Disabled</Button></div></Container>}
      {show('field') && <Container title="Fields" icon="edit"><div className={`${P}__gallery-card`}><TextField label="Name" value="Midnight" onChange={() => {}} hint="A sample text field" /><SelectField label="Tone" value="warm" onChange={() => {}} options={[{ value: 'warm', label: 'Warm' }, { value: 'cool', label: 'Cool' }]} /><Switch label="Follow the hub skin" checked={on} onChange={setOn} /></div></Container>}
      {show('segmented') && <Container title="Segmented" icon="sliders"><Segmented label="Sample" value={seg} onChange={setSeg} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} /></Container>}
      {show('chip') && <Container title="Chips" icon="star"><div className={`${P}__wrap`}><Chip>Plain</Chip><Chip tone="accent">Accent</Chip><Chip tone="success">Success</Chip><Chip tone="warning">Warning</Chip><Chip tone="danger">Danger</Chip></div></Container>}
      {show('tab-group') && <Container title="Tabs" icon="layers"><TabGroup id="skin-editor-sample" label="Sample tabs" value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Open', badge: 3 }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} /><p className="fx-muted">{tab === 'open' ? 'Three open items.' : tab === 'done' ? 'Nothing done yet.' : 'Everything.'}</p></Container>}
      {show('container') && <Container title="Card" icon="grid"><p>A container with text, a <a href="#sample" onClick={(e) => e.preventDefault()}>link</a> and a caption.</p><p className="fx-muted">Captions use the muted colour.</p></Container>}
      {show('grid') && <Container title="Grid" icon="list"><div className="fx-tablewrap"><table className="fx-table"><thead><tr><th>Build</th><th>Status</th><th>Model</th></tr></thead><tbody>{[['Token registry', 'Running', 'Fable'], ['Tab groups', 'Landed', 'Opus'], ['Transparency token', 'Landed', 'Opus']].map(([a, b, c], i) => <tr key={a} className={`${P}__row`} aria-selected={i === 0}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody></table></div></Container>}
      {show('note') && <Container title="Notes" icon="info"><div className={`${P}__gallery-card`}><Note tone="info">An information note.</Note><Note tone="success">Saved and applied.</Note><Note tone="warning">Check this first.</Note><Note tone="danger">Something broke.</Note></div></Container>}
      {show('toolbar') && <Container title="Toolbar" icon="menu"><div className="fx-toolbar" role="toolbar" aria-label="Sample toolbar"><Button size="sm" icon="plus">New</Button><Button size="sm" icon="refresh">Refresh</Button><IconButton icon="search" label="Search" /><IconButton icon="more" label="More" /></div></Container>}
      {show('slider') && <Container title="Slider" icon="sliders"><Slider label="Sample" value={n} onChange={setN} unit="%" /></Container>}
      {show('dialog') && <Container title="Dialog" icon="maximize"><div className="fx-dialog" role="dialog" aria-label="Sample dialog"><header className="fx-dialog__head"><h2>Export as a new skin</h2></header><div className="fx-dialog__body"><TextField label="Name" value="Midnight" onChange={() => {}} /></div><footer className={`${P}__wrap`}><Button tone="primary">Export</Button><Button>Cancel</Button></footer></div></Container>}
    </div>
  );
}

/** What the sandbox draws for a picked UI: a registered view, a dialog, a plugin's first view, or the element gallery. */
function SandboxContent({ ui }: { ui: UiPick }) {
  const rt = useRuntime();
  if (ui.kind === 'element') return <ElementGallery only={ui.id === 'all' ? undefined : ui.id} />;
  if (ui.kind === 'dialog') {
    const d = rt.uiRenderers.dialogs[ui.id];
    return d ? <div className="fx-dialog" role="dialog" aria-label={d.title}><header className="fx-dialog__head"><h2>{d.title}</h2></header><div className="fx-dialog__body">{d.render({}, () => {}) as ReactNode}</div></div> : <Note tone="warning">The dialog {ui.id} is not registered in this console.</Note>;
  }
  const viewId = ui.kind === 'plugin' ? (rt.libraries.find((l) => l.id.endsWith(`.${ui.id}`) || l.label === ui.label)?.ui?.views[0]?.id ?? ui.id) : ui.id;
  const v = rt.uiRenderers.views[viewId];
  return v ? <>{v.render() as ReactNode}</> : <Note tone="warning">The screen {viewId} is not registered in this console.</Note>;
}

function TokenRow({ token, value, onChange }: { token: RegistryToken; value: string | number | boolean | undefined; onChange: (v: string | null) => void }) {
  const edited = value !== undefined;
  const shown = value === undefined ? '' : String(value);
  const placeholder = String(token.default || '');
  const label = token.id.replace(/^--fx-/, '').replace(/-/g, ' ');
  return (
    <div className={`${P}__token ${edited ? `${P}__token--edited` : ''}`} data-token={token.id}>
      <span className={`${P}__token-name`} title={token.id}>{isColourToken(token) && <span className={`${P}__swatch`} style={{ background: shown || `var(${token.id})` }} />}{token.id.replace(/^--fx-/, '')}</span>
      <span className={`${P}__wrap`}>{edited && <IconButton icon="undo" label={`Back to the default for ${token.id}`} onClick={() => onChange(null)} />}</span>
      {isColourToken(token)
        ? <ColorField label={label} value={shown} onChange={(v) => onChange(v)} hint={token.description} />
        : <TextField label={label} value={shown} onChange={(v) => onChange(v === '' ? null : v)} placeholder={placeholder || 'default'} hint={token.description} />}
    </div>
  );
}

export function SkinEditorView() {
  const rt = useRuntime();
  const ax = useAxfState();
  const [tokens, setTokens] = useState<RegistryToken[]>([]);
  const [uis, setUis] = useState<UiListItem[]>([]);
  const [ui, setUi] = useState<UiPick | null>(() => { try { const s = rt.settings.get(UI_KEY); return s ? (JSON.parse(String(s)) as UiPick) : null; } catch { return null; } });
  const [session, setSession] = useState<Session | null>(null);
  const [level, setLevel] = useState<TokenLevel>(String(rt.settings.get(LEVEL_KEY) ?? 'basic') as TokenLevel);
  const [element, setElement] = useState(String(rt.settings.get(ELEMENT_KEY) ?? ''));
  const [panel, setPanel] = useState<Panel>((String(rt.settings.get(PANEL_KEY) ?? 'tokens') as Panel));
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [exportName, setExportName] = useState('');
  const [exportDesc, setExportDesc] = useState('');
  const [exported, setExported] = useState<api.ExportResult | null>(null);
  const [skins, setSkins] = useState<{ id: string; name: string; description: string; tokens: number }[]>([]);
  const [live, setLive] = useState<Record<string, string | number | boolean>>({});
  const sandboxRef = useRef<HTMLDivElement>(null);

  const loadRegistry = useCallback(() => api.registry({ level: 'advanced' }).then((r) => setTokens(r.tokens), (e: Error) => setMsg(e.message)), []);
  useEffect(() => { void loadRegistry(); api.uis().then((r) => setUis(r.uis), () => setUis([])); api.skins().then((r) => setSkins(r.skins), () => setSkins([])); }, [loadRegistry]);
  useEditorSync({ onRefresh: () => { void loadRegistry(); if (ui) void api.session(ui).then(setSession, () => {}); } });

  // the console's live UIs (views, dialogs) join the manifests' list
  const allUis = useMemo<UiListItem[]>(() => {
    const seen = new Set<string>();
    const out: UiListItem[] = [];
    const add = (u: UiListItem) => { const k = api.uiKey(u); if (!seen.has(k)) { seen.add(k); out.push(u); } };
    for (const [id, v] of Object.entries(rt.uiRenderers.views)) add({ kind: 'view', id, label: v.title, source: 'console' });
    for (const [id, d] of Object.entries(rt.uiRenderers.dialogs)) if (d.searchable !== false) add({ kind: 'dialog', id, label: d.title, source: 'console' });
    add({ kind: 'element', id: 'all', label: 'Element gallery (every control)', source: 'elements' });
    for (const u of uis) add(u);
    return out;
  }, [uis, rt]);

  const choose = useCallback(async (next: UiPick) => {
    setUi(next); setLive({}); setExported(null);
    rt.settings.set(UI_KEY, JSON.stringify(next));
    try { setSession(await api.pick(next)); setMsg(''); } catch (e) { setMsg((e as Error).message); }
  }, [rt]);
  useEffect(() => { if (ui && !session) void choose(ui); }, [ui, session, choose]);

  // deep links: skin-editor.open:view:<id> | dialog:<id> | element:<id> | plugin:<id> | token:<token id> | pick
  useEffect(() => {
    const off = rt.actions.register('skin-editor.load', (args) => {
      const [kind, ...rest] = args;
      const id = rest.join(':');
      if (kind === 'token') { setPanel('tokens'); setQ(id.replace(/^--fx-/, '')); setLevel('advanced'); return; }
      if (kind === 'pick') { setPicking(true); return; }
      if (kind && id) { const found = allUis.find((u) => u.kind === kind && u.id === id); void choose(found ?? { kind: kind as UiPick['kind'], id, label: id }); }
    }, { label: 'Skin editor: load a UI into the sandbox', params: true });
    return off;
  }, [rt, allUis, choose]);

  const state = useMemo(() => ({ ...(session?.state ?? {}), ...live }), [session, live]);
  const head = session?.chain.find((s) => s.id === session.head);

  /* edits: the sandbox follows the keystroke (live), the snapshot lands when the value settles */
  const commitTimer = useRef<number | null>(null);
  const pending = useRef<Record<string, string | null>>({});
  const flush = useCallback(async () => {
    if (!ui) return;
    const edits = Object.entries(pending.current).map(([token, to]) => ({ token, to }));
    pending.current = {};
    if (!edits.length) return;
    try { const r = await api.edit(ui, edits, 'skin-editor'); setSession(r); setLive({}); setMsg(''); } catch (e) { setMsg((e as Error).message); }
  }, [ui]);
  const edit = (token: string, to: string | null) => {
    setLive((l) => { const n = { ...l }; if (to === null) delete n[token]; else n[token] = to; return n; });
    pending.current[token] = to;
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => void flush(), 500);
  };
  useEffect(() => () => { if (commitTimer.current) window.clearTimeout(commitTimer.current); }, []);

  const revertTo = async (id: string) => { if (!ui) return; setBusy(true); try { setSession(await api.revert(ui, { snapshot: id })); setLive({}); setMsg(''); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  const undo = async () => { if (!ui) return; setBusy(true); try { setSession(await api.undo(ui)); setLive({}); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  const doExport = async () => {
    if (!ui || !exportName.trim()) return;
    setBusy(true);
    try {
      const r = await api.exportSkin(ui, { id: skinIdOf(exportName), name: exportName.trim(), description: exportDesc, base: baseFromActive(ax.active as unknown as Record<string, string>) });
      setExported(r);
      const reg = rt.registry.register(r.asset, 'imported', 'skin-editor');
      rt.toast(reg.ok ? `Skin ${r.asset.name} exported and registered` : `Skin ${r.asset.name} exported (not registered: ${reg.errors?.join('; ') ?? 'invalid'})`, reg.ok ? 'success' : 'warning', 'Skin editor');
      api.skins().then((s) => setSkins(s.skins), () => {});
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  /* pick an element inside the sandbox: its tokens become the list */
  const onSandboxClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    const el = elementOf(e.target as Element, sandboxRef.current);
    setPicking(false);
    if (el) { setElement(el); rt.settings.set(ELEMENT_KEY, el); setLevel((l) => (l === 'basic' ? 'pro' : l)); setPanel('tokens'); rt.toast(`${ELEMENT_LABELS[el] ?? el}: its tokens are listed`, 'info', 'Skin editor'); } else rt.toast('That is not a framework element; pick a control', 'warning', 'Skin editor');
  };

  const listed = useMemo(() => visibleTokens(tokens, level, element, q), [tokens, level, element, q]);
  const groups = useMemo(() => groupByElement(listed), [listed]);
  const edits = Object.keys(state).length;

  return (
    <div className={`${P} fx-stack`}>
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Framework</p><h1>Skin editor</h1></div></header>
      <div className={`${P}__bar`} role="toolbar" aria-label="Skin editor">
        <SelectField label="UI" value={ui ? api.uiKey(ui) : ''} onChange={(k) => { const u = allUis.find((x) => api.uiKey(x) === k); if (u) void choose(u); }} options={[{ value: '', label: 'Pick a UI…' }, ...allUis.map((u) => ({ value: api.uiKey(u), label: `${u.kind}: ${u.label}` }))]} />
        <Button size="sm" icon="eye" title="Click a screen anywhere in the console to load it here" onClick={() => rt.dispatch('skin-editor.pick')}>Pick on screen</Button>
        <Button size="sm" icon="layers" title="Click a control inside the sandbox to edit its tokens" onClick={() => setPicking((p) => !p)} aria-pressed={picking}>{picking ? 'Click a control…' : 'Pick element'}</Button>
        {element && <Chip tone="accent">{ELEMENT_LABELS[element] ?? element} <button type="button" className="fx-btn fx-btn--sm fx-btn--quiet" aria-label="Every element" onClick={() => { setElement(''); rt.settings.set(ELEMENT_KEY, ''); }}>×</button></Chip>}
        <span className={`${P}__grow`} />
        <Button size="sm" icon="undo" disabled={!head?.parent || busy} onClick={() => void undo()}>Undo</Button>
        <Button size="sm" icon="list" title="Browse every token in the system" onClick={() => rt.navigate('token-registry')}>Token registry</Button>
        <Chip>{edits} edit{edits === 1 ? '' : 's'} · {session?.chain.length ?? 0} snapshot{session?.chain.length === 1 ? '' : 's'}</Chip>
      </div>
      {msg && <Note tone="danger">{msg}</Note>}
      <div className={`${P}__body`}>
        <div ref={sandboxRef} className={`${P}__sandbox ${picking ? `${P}__sandbox--picking` : ''}`} style={cssVars(state)} onClickCapture={onSandboxClick} data-axf-sandbox={ui ? api.uiKey(ui) : ''}>
          <span className={`${P}__sandbox-label`}><Icon name="eye" size={12} /> Sandbox · {ui ? `${ui.kind}: ${ui.label || ui.id}` : 'nothing picked'}{head && head.id !== 'default' ? ` · ${head.label}` : ' · default skin'}</span>
          <div className={`${P}__sandbox-inner`}>{ui ? <SandboxContent key={api.uiKey(ui)} ui={ui} /> : <Note tone="info">Pick a UI from the list, click Pick on screen and then any screen in the console, or start with the element gallery.</Note>}</div>
        </div>
        <aside className={`${P}__side`}>
          <TabGroup id="skin-editor-panels" label="Skin editor panels" value={panel} onChange={(p) => { setPanel(p); rt.settings.set(PANEL_KEY, p); }} tabs={PANELS.map((p) => ({ value: p.value, label: p.label, icon: p.icon }))} />
          {panel === 'tokens' && (
            <>
              <div className={`${P}__bar`} role="toolbar" aria-label="Token level">
                <Segmented label="Level" size="sm" value={level} onChange={(l) => { setLevel(l); rt.settings.set(LEVEL_KEY, l); }} options={LEVELS.map((l) => ({ value: l.value, label: l.label, title: l.title }))} />
                <input className="fx-input" placeholder="Find a token" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a token" />
              </div>
              <div className={`${P}__tokens`}>
                {groups.map((g) => (
                  <details key={g.element} className={`${P}__group`} open={groups.length <= 3 || g.tokens.some((t) => state[t.id] !== undefined) || Boolean(element)}>
                    <summary>{ELEMENT_LABELS[g.element] ?? g.element} · {g.tokens.length}</summary>
                    {g.tokens.map((t) => <TokenRow key={t.id} token={t} value={state[t.id]} onChange={(v) => edit(t.id, v)} />)}
                  </details>
                ))}
                {!groups.length && <p className="fx-muted">No token at this level matches. Raise the level or clear the words.</p>}
              </div>
            </>
          )}
          {panel === 'history' && (
            <Container title="Snapshots" icon="clock">
              <p className="fx-muted">Every edit is a snapshot. Click one to revert to it: the revert is a new snapshot, so nothing is lost.</p>
              <ol className={`${P}__chain`}>
                {(session?.rows ?? []).map((r) => (
                  <li key={r.id} className={`${P}__snap`} aria-current={r.head} data-kind={r.kind} data-on-path={r.onPath} data-fx-row tabIndex={0} title={`${r.id} · ${r.at}`} onClick={() => !r.head && void revertTo(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' && !r.head) void revertTo(r.id); }}>
                    <span className={`${P}__rail`}><span className={`${P}__dot`} /></span>
                    <span><span className={`${P}__snap-label`}>{r.label}</span><br /><span className={`${P}__snap-meta`}>{ago(r.at)} · {r.tokens} token{r.tokens === 1 ? '' : 's'} · {r.by}</span></span>
                    {r.head ? <Chip tone="accent">head</Chip> : <Button size="sm" icon="restore" onClick={(e) => { e.stopPropagation(); void revertTo(r.id); }}>Revert</Button>}
                  </li>
                ))}
              </ol>
            </Container>
          )}
          {panel === 'export' && (
            <Container title="Export as a new skin" icon="download">
              <div className="fx-stack">
                <TextField label="Name" value={exportName} onChange={setExportName} placeholder="Midnight" hint={exportName ? `Skin id: ${skinIdOf(exportName) || '…'}` : 'The exported skin starts from the console\'s look as it stands and carries every edit of the head snapshot.'} />
                <TextField label="Description" value={exportDesc} onChange={setExportDesc} placeholder="What this skin is for" />
                <Button tone="primary" icon="download" disabled={!exportName.trim() || busy || !ui} onClick={() => void doExport()}>Export {edits} edit{edits === 1 ? '' : 's'} as a skin</Button>
                {exported && <Note tone={exported.unmapped.length ? 'warning' : 'success'}>Exported <b>{exported.asset.name}</b> ({exported.asset.id}): {exported.mapped.length} token{exported.mapped.length === 1 ? '' : 's'} as control overrides{exported.unmapped.length ? `, ${exported.unmapped.length} stylesheet variable(s) kept under the skin's own key (${exported.unmapped.join(', ')})` : ''}.</Note>}
                {skins.length > 0 && <div><p className="fx-eyebrow">Exported skins</p>{skins.map((s) => <Fragment key={s.id}><Chip>{s.name} · {s.tokens}</Chip> </Fragment>)}</div>}
              </div>
            </Container>
          )}
        </aside>
      </div>
    </div>
  );
}
