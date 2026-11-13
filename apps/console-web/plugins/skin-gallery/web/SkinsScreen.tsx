/**
 * The Skins screen: every skin in a gallery, a live preview (the console itself shows the picked skin through
 * rt.previewSkin, framed at desktop or phone width), and Use skin / Back / Restore to Default / Undo for one scope:
 * the whole hub, this app, one screen or one plugin. Every button calls the plugin's REST routes (skin-switch@1).
 * Deep link: #/skin-gallery?skin=<id>&scope=<scope>&view=phone.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Segmented, SelectField, TabGroup, TextField, useAxfState, useRuntime } from '@console/axf/react';
import { backAt, listScopes, listSkins, readState, restoreAt, undoLast, useSkinAt, type ScopeView, type SkinRow } from './api';

type Kind = 'hub' | 'app' | 'ui' | 'plugin';
type Frame = 'desktop' | 'phone';
const KINDS: { value: Kind; label: string; icon: string }[] = [
  { value: 'hub', label: 'Whole hub', icon: 'cloud' },
  { value: 'app', label: 'This app', icon: 'monitor' },
  { value: 'ui', label: 'One screen', icon: 'layout' },
  { value: 'plugin', label: 'One plugin', icon: 'box' },
];
const ACTION_LABEL: Record<string, string> = { use: 'Use skin', 'back-to-skin': 'Back to skin', 'restore-default': 'Restore to Default', undo: 'Undo' };

const readLink = () => { const q = new URLSearchParams(location.hash.split('?')[1] ?? ''); return { skin: q.get('skin') ?? '', scope: q.get('scope') ?? '', view: q.get('view') === 'phone' ? 'phone' as const : 'desktop' as const }; };
const kindOf = (scope: string): Kind => (scope.startsWith('ui:') ? 'ui' : scope.startsWith('plugin:') ? 'plugin' : scope === 'hub' ? 'hub' : 'app');
const scopeLabel = (s: string) => (s === 'hub' ? 'the whole hub' : s.startsWith('app') ? 'this app' : s.startsWith('ui:') ? `screen ${s.slice(3)}` : `plugin ${s.slice(7)}`);

export function SkinsScreen() {
  const rt = useRuntime();
  const st = useAxfState();
  const link = useMemo(readLink, []);
  const [skins, setSkins] = useState<SkinRow[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [kind, setKind] = useState<Kind>(link.scope ? kindOf(link.scope) : 'app');
  const [target, setTarget] = useState(link.scope.includes(':') && !link.scope.startsWith('app') ? link.scope.split(':').slice(1).join(':') : '');
  const [frame, setFrame] = useState<Frame>(link.view);
  const [picked, setPicked] = useState(link.skin);
  const [view, setView] = useState<ScopeView | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const scope = kind === 'hub' ? 'hub' : kind === 'app' ? 'app' : target ? `${kind}:${target}` : '';
  const refresh = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([listSkins(), listScopes()]);
      setSkins(s); setKnown(k);
      setView(scope ? await readState(scope) : null);
    } catch (e) { setMsg((e as Error).message); }
  }, [scope]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { rt.previewSkin(picked && picked !== view?.inForce.id ? picked : null); }, [rt, picked, view?.inForce.id]);
  useEffect(() => () => { rt.previewSkin(null); }, [rt]);

  const act = async (name: string, fn: () => Promise<ScopeView>) => {
    setBusy(name); setMsg('');
    try { const v = await fn(); setView(v); setMsg(`${ACTION_LABEL[name]} done for ${scopeLabel(v.scope)}.`); const [s, k] = await Promise.all([listSkins(), listScopes()]); setSkins(s); setKnown(k); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(''); }
  };

  const targets = known.filter((s) => s.startsWith(`${kind}:`)).map((s) => s.slice(kind.length + 1));
  const here = kind === 'ui' ? st.view : kind === 'plugin' ? 'ai.amberx.axf.console.skin-gallery' : '';
  const options = [...new Set([...(here ? [here] : []), ...targets])].map((v) => ({ value: v, label: v }));
  const current = skins.find((s) => s.id === picked);
  const inForce = view?.inForce.id ? skins.find((s) => s.id === view.inForce.id)?.name ?? view.inForce.id : 'no skin';

  return (
    <div className="fx-stack fx-stack--lg axp-skin-gallery" data-axf-skin-gallery="">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugins</p><h1>Skins</h1><p className="fx-muted">Tap a skin to preview it live. Nothing is saved until Use skin.</p></div></header>

      <TabGroup id="skin-gallery.scope" label="Where to switch" value={kind} onChange={(v) => { setKind(v as Kind); setTarget(''); }} tabs={KINDS} />
      {(kind === 'ui' || kind === 'plugin') && (
        <div className="axp-skin-gallery__target">
          <SelectField label={kind === 'ui' ? 'Screen' : 'Plugin'} value={target} empty="Pick one…" options={options} onChange={setTarget} />
          <TextField label="Or type its id" value={target} onChange={setTarget} placeholder={kind === 'ui' ? 'home' : 'ai.amberx.axf.console.notes'} mono />
        </div>
      )}

      <Container title={scope ? `In force at ${scopeLabel(scope)}` : 'Pick a scope'} icon="palette">
        <p className="fx-muted axp-skin-gallery__now">
          {view ? <>{inForce} · decided at {view.inForce.from}{view.overridden.length ? ` · ${view.overridden.length} change(s) on top` : ''}</> : 'Pick the screen or plugin first.'}
        </p>
        <div className="axp-skin-gallery__actions" role="toolbar" aria-label="Skin actions">
          <Button tone="primary" icon="check" busy={busy === 'use'} disabled={!scope || !picked || picked === view?.state.id && view?.state.use === 'on'} data-help="skin-gallery.use" onClick={() => void act('use', () => useSkinAt(picked, scope))}>Use skin</Button>
          <Button tone="neutral" icon="arrow-left" busy={busy === 'back-to-skin'} disabled={!scope || !view?.overridden.length} data-help="skin-gallery.back" onClick={() => void act('back-to-skin', () => backAt(scope))}>Back to skin</Button>
          <Button tone="quiet" icon="refresh" busy={busy === 'restore-default'} disabled={!scope} undoable confirm={`Restore ${scope ? scopeLabel(scope) : ''} to its default look? You can undo it once.`} data-help="skin-gallery.restore" onClick={() => void act('restore-default', () => restoreAt(scope))}>Restore to Default</Button>
          <Button tone="quiet" icon="undo" busy={busy === 'undo'} disabled={!view?.canUndo} title={view?.undo ? `Undo ${ACTION_LABEL[view.undo.action] ?? view.undo.action} at ${scopeLabel(view.undo.scope)}` : 'Nothing to undo'} data-help="skin-gallery.undo" onClick={() => void act('undo', undoLast)}>Undo</Button>
        </div>
        {msg && <p role="status" aria-live="polite" className="axp-skin-gallery__msg">{msg}</p>}
      </Container>

      <div className="axp-skin-gallery__body">
        <div className="axp-skin-gallery__grid" role="listbox" aria-label="Skins">
          {skins.map((s) => (
            <Button key={s.id} tone="quiet" className={`axp-skin-gallery__card${s.id === picked ? ' is-picked' : ''}`} role="option" aria-selected={s.id === picked} title={s.description} onClick={() => setPicked(s.id === picked ? '' : s.id)}>
              <strong>{s.name}</strong>
              <span className="fx-muted">{s.kind === 'design-package' ? 'Design package' : s.iconPack ? `Icons: ${s.iconPack}` : 'Skin'}{s.parts.length ? ` · styles ${s.parts.length} part(s)` : ''}</span>
              {s.inForceAt.length > 0 && <Chip tone="accent">In use: {s.inForceAt.map(scopeLabel).join(', ')}</Chip>}
            </Button>
          ))}
        </div>

        <Container title={current ? `Preview: ${current.name}` : 'Preview'} icon="eye" className="axp-skin-gallery__preview">
          <div role="toolbar" aria-label="Preview size" className="axp-skin-gallery__frames">
            <Segmented label="Preview size" value={frame} onChange={setFrame} options={[{ value: 'desktop', label: 'Desktop', icon: 'monitor' }, { value: 'phone', label: 'Phone', icon: 'smartphone' }]} />
          </div>
          <div className={`axp-skin-gallery__frame is-${frame}`} data-help="skin-gallery.view">
            <div className="fx-stack">
              <p className="fx-eyebrow">Sample</p>
              <h2>{current?.name ?? inForce}</h2>
              <p className="fx-muted">{current?.description || 'The whole console shows the skin you tap, live, until you leave this screen or tap it again.'}</p>
              <div className="fx-row"><Button tone="primary" size="sm">Primary</Button><Button size="sm">Neutral</Button><Chip tone="success">Chip</Chip></div>
              <TextField label="Field" value="" onChange={() => undefined} placeholder="Type here" />
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}
