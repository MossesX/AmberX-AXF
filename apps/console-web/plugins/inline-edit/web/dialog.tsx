/**
 * The edit dialog (`inline-edit-element`): what a right-click in inline edit mode opens.
 *
 *   breadcrumb  the element from the root down to the child that was hit; any step can be picked as the edit target
 *   scope       "This item only" or "This item and everything under <a parent>" (parent scope at that parent)
 *   note        changes override what the element inherits from axHub, under the existing override rules
 *   views       tree · classic tree · grid with expandable rows (views.tsx); each token shows its inherited axHub value
 *   editors     colour, size, font, choices, on/off, text (editors.tsx): live preview at once, saved after a short pause
 *
 * The dialog's state (path, scope, view) lives on the server per user, so `PUT element` (REST, MCP, CLI, voice) moves an
 * open dialog too: it re-reads the state every 3 s while open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, Note, Segmented, SelectField, useRuntime } from '@console/axf/react';
import { chainOf, parsePath, labelOfSegment } from '../../../framework/index.mjs';
import { errText, getElementUi, getTokens, parseArg, setElementUi, setToken, unsetToken, CHANGED_EVENT, type ElementTokens, type Scope, type TokenRow, type TokenValue, type ViewKind } from './api';
import type { Applier } from './apply';
import { ClassicTreeView, GridView, TreeView } from './views';

export const DIALOG = 'inline-edit-element';
let applier: Applier | null = null;
export const setApplier = (a: Applier) => { applier = a; };

const VIEWS: { value: ViewKind; label: string; icon: string }[] = [
  { value: 'tree', label: 'Tree', icon: 'list' },
  { value: 'classic', label: 'Classic tree', icon: 'folder' },
  { value: 'grid', label: 'Grid', icon: 'grid' },
];

const labelOf = (path: string) => {
  const p = parsePath(path);
  if (!p) return path;
  const last = p.segments.at(-1) ?? { name: p.root.kind, id: p.root.instance };
  return labelOfSegment(last, p.root.kind);
};

export function ElementDialog({ arg, close }: { arg: string; close: () => void }) {
  const rt = useRuntime();
  const first = parseArg(arg);
  const [path, setPath] = useState(first.path ?? '');
  const [scope, setScope] = useState<Scope>(first.scope ?? 'item');
  /** the parent the parent-scope edits go to (default: the element itself = it and everything under it) */
  const [at, setAt] = useState('');
  const [view, setView] = useState<ViewKind>(first.view ?? 'tree');
  const [data, setData] = useState<ElementTokens | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Record<string, TokenValue>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const seen = useRef('');

  const target = scope === 'parent' ? (at || path) : path;

  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await getTokens(path)); setError(''); } catch (e) { setError(errText(e)); }
  }, [path]);

  // the state on the server: the deep link / API may have set it; adopt it now and whenever it changes while open
  useEffect(() => {
    let live = true;
    const pull = async () => {
      try {
        const ui = await getElementUi();
        const key = JSON.stringify(ui);
        if (!live || key === seen.current) return;
        const firstPull = seen.current === '';
        seen.current = key;
        if (firstPull && first.path) return; // the right-click / deep link wins on open (it wrote the server already)
        if (ui.path) setPath(ui.path);
        setScope(ui.scope);
        setView(ui.view);
      } catch { /* server part off: the dialog still works on what it was opened with */ }
    };
    void pull();
    const t = setInterval(() => void pull(), 3_000);
    return () => { live = false; clearInterval(t); };
  }, [first.path]);

  // a deep link or a right-click: what it opened on is the dialog's state on the server (readable by every surface)
  useEffect(() => {
    if (first.path || first.scope || first.view) remember({ ...(first.path ? { path: first.path } : {}), ...(first.scope ? { scope: first.scope } : {}), ...(first.view ? { view: first.view } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const f = () => void load(); globalThis.addEventListener(CHANGED_EVENT, f); return () => globalThis.removeEventListener(CHANGED_EVENT, f); }, [load]);
  useEffect(() => () => { for (const t of Object.values(timers.current)) clearTimeout(t); applier?.clearPreview(); }, []);
  useEffect(() => { setAt(''); }, [path]);

  const remember = (patch: { path?: string; scope?: Scope; view?: ViewKind }) => {
    void setElementUi(patch).then((ui) => { seen.current = JSON.stringify(ui); }).catch(() => undefined);
  };

  const onEdit = (token: string, value: TokenValue) => {
    setPending((p) => ({ ...p, [token]: value }));
    applier?.preview(target, token, value); // live preview, before the save lands
    clearTimeout(timers.current[token]);
    timers.current[token] = setTimeout(() => {
      setToken({ path: target, token, value, scope })
        .then(() => load())
        .then(() => { setPending((p) => { const n = { ...p }; delete n[token]; return n; }); applier?.clearPreview(target); })
        .catch((e: unknown) => rt.toast(errText(e), 'danger', 'Inline edit'));
    }, 450);
  };
  const onRevert = (row: TokenRow) => {
    unsetToken({ path: target, token: row.token, scope })
      .then(() => { rt.toast(`${row.label} is back to ${row.axHubValue ?? 'the theme'} from axHub.`, 'success', 'Inline edit'); return load(); })
      .catch((e: unknown) => rt.toast(errText(e), 'danger', 'Inline edit'));
  };
  const onTarget = (p: string) => {
    if (p === path) { setScope('item'); remember({ scope: 'item' }); return; }
    setScope('parent'); setAt(p); remember({ scope: 'parent' });
  };

  if (!path) {
    return (
      <div className="axp-inline-edit axp-inline-edit__dialog">
        <Note tone="info" icon="info">Turn on Inline edit mode (Settings → Appearance), then right-click any element to edit its tokens.</Note>
        <div className="fx-row"><Button onClick={close}>Close</Button></div>
      </div>
    );
  }

  const chain = chainOf(path);
  const scopeOptions = [
    { value: `item|${path}`, label: `This item only (${labelOf(path)})` },
    ...chain.slice().reverse().map((p) => ({ value: `parent|${p}`, label: p === path ? `This item and everything under it` : `Everything under ${labelOf(p)}` })),
  ];
  const props = data ? { data, target, scope, pending, onEdit, onRevert, onTarget } : null;

  return (
    <div className="axp-inline-edit axp-inline-edit__dialog" data-axf-inline-ignore="">
      <nav className="axp-inline-edit__crumbs" aria-label="Element, from the root to the child" data-axf-not-nav="breadcrumb">
        {chain.map((p, i) => (
          <span key={p} className="axp-inline-edit__crumb">
            {i > 0 && <Icon name="chevron-right" size={11} />}
            <Button size="sm" tone={p === target ? 'primary' : 'quiet'} title={p} onClick={() => onTarget(p)}>{labelOf(p)}</Button>
          </span>
        ))}
      </nav>
      <code className="axp-inline-edit__path" title="Element path (inline-edit-tokens@1)">{target}</code>

      <div className="axp-inline-edit__bar" role="toolbar" aria-label="Edit element">
        <SelectField label="Apply changes to" value={`${scope}|${target}`} options={scopeOptions} onChange={(v) => {
          const [s, p] = v.split('|') as [Scope, string];
          setScope(s); setAt(s === 'parent' ? p : ''); remember({ scope: s });
        }} />
        <Segmented label="View" value={view} options={VIEWS} onChange={(v) => { setView(v); remember({ view: v }); }} />
      </div>

      <Note tone="warning" icon="layers">
        Changes here override what this element inherits from axHub, under the existing override rules: an item override beats
        a parent one, the nearest parent wins, and a theme swap still restyles it. Each token shows the value it inherits from
        axHub; Revert to axHub removes only that one override. Every override is listed under Overrides.
      </Note>

      {error && <Note tone="danger" icon="alert">{error}</Note>}
      {!data && !error && <p className="fx-muted">Loading tokens…</p>}
      {props && view === 'tree' && <TreeView {...props} />}
      {props && view === 'classic' && <ClassicTreeView {...props} />}
      {props && view === 'grid' && <GridView {...props} />}

      <div className="fx-row fx-row--wrap axp-inline-edit__foot">
        <Button icon="layers" tone="quiet" onClick={() => { close(); rt.navigate('inline-edit-overrides'); }}>All overrides</Button>
        <Button tone="primary" onClick={close}>Done</Button>
      </div>
    </div>
  );
}
