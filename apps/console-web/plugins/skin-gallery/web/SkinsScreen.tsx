/**
 * The Skins screen: every skin as a card (name, icon pack, coverage of the asset types, where it is in use), the scope
 * picker (hub / app / screen / plugin), the action toolbar (Use skin, Back to skin, Restore to Default, Undo) and the
 * live preview at desktop and phone width. Every button calls the plugin's REST routes (skin-switch@1). The screen is a
 * SkinScope root of its own plugin, so a skin set for the Skins plugin itself shows here.
 * Deep links: #/skin-gallery?skin=&scope=&view=phone, or console_open … focus skin/<id> | scope/<scope> | preview/<id>?view=phone.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, SkinScope, useRuntime } from '@console/axf/react';
import { followAt, getActingApp, listScopes, listSkins, PLUGIN_ID, readState, scopeLabel, setActingApp, type ScopeView, type SkinRow } from './api';
import { getLink, linkFromHash, subscribeLink } from './link';
import { kindOf, ScopePicker, scopeOf, type Kind } from './ScopePicker';
import { SkinActions } from './SkinActions';
import { SkinPreview, type Frame } from './SkinPreview';
import { defaultScope, settings } from './settings';

const targetOf = (scope: string) => (scope.includes(':') && !scope.startsWith('app') ? scope.split(':').slice(1).join(':') : '');

export function SkinsScreen() {
  const rt = useRuntime();
  const first = getLink().seq ? getLink() : linkFromHash();
  const start = first.scope || defaultScope();
  const [skins, setSkins] = useState<SkinRow[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [kind, setKind] = useState<Kind>(kindOf(start));
  const [target, setTarget] = useState(targetOf(start));
  const [app, setApp] = useState(getActingApp());
  const [frame, setFrame] = useState<Frame>(first.view || (settings().previewView === 'phone' ? 'phone' : 'both'));
  const [picked, setPicked] = useState(first.skin);
  const [view, setView] = useState<ScopeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<{ text: string; seq: number } | null>(null);
  const [err, setErr] = useState('');
  const [layout, setLayout] = useState(first.layout || 'split');

  // a deep link while the screen is open (console_open … focus) moves it there
  const link = useSyncExternalStore(subscribeLink, getLink, getLink);
  useEffect(() => {
    if (!link.seq) return;
    if (link.skin) setPicked(link.skin);
    if (link.scope) { setKind(kindOf(link.scope)); setTarget(targetOf(link.scope)); }
    if (link.view) setFrame(link.view);
    if (link.layout) setLayout(link.layout);
  }, [link]);

  const scope = scopeOf(kind, target);
  const refresh = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([listSkins(), listScopes()]);
      setSkins(s); setKnown(k); setErr('');
      setView(scope ? await readState(scope) : null);
    } catch (e) { setErr((e as Error).message); }
  }, [scope, app]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { rt.previewSkin(picked && picked !== view?.inForce.id ? picked : null); }, [rt, picked, view?.inForce.id]);
  useEffect(() => () => { rt.previewSkin(null); }, [rt]);

  const done = (v: ScopeView) => { setView(v); void Promise.all([listSkins(), listScopes()]).then(([s, k]) => { setSkins(s); setKnown(k); }, () => undefined); };
  const follow = (on: boolean) => {
    setBusy(true);
    void followAt(scope, on).then((v) => { done(v); setSnack({ text: `${scopeLabel(v.scope)} ${on ? 'follows its parent' : 'keeps its own skin'} now.`, seq: Date.now() }); }, (e: Error) => setErr(e.message)).finally(() => setBusy(false));
  };
  const pickApp = (a: string) => { setActingApp(a); setApp(a); };
  const current = skins.find((s) => s.id === picked);
  const inForceName = view?.inForce.id ? skins.find((s) => s.id === view.inForce.id)?.name ?? view.inForce.id : 'No skin';

  return (
    <SkinScope kind="plugin" id={PLUGIN_ID} className="fx-stack fx-stack--lg axp-skin-gallery" attrs={{ 'data-axf-skin-gallery': '', 'data-layout': layout }}>
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugins</p><h1>Skins</h1><p className="fx-muted">Tap a skin to preview it live. Nothing is saved until Use skin.</p></div></header>

      <ScopePicker kind={kind} target={target} app={app} known={known} view={view} skins={skins} busy={busy}
        onKind={(k) => { setKind(k); setTarget(''); }} onTarget={setTarget} onApp={pickApp} onFollow={follow} />

      <SkinActions scope={scope} picked={picked} view={view} onDone={done} snack={snack} />
      {err && <p role="alert" className="fx-muted axp-skin-gallery__msg">{err}</p>}

      <div className={`axp-skin-gallery__body is-${layout}`}>
        <div className="axp-skin-gallery__grid" role="listbox" aria-label="Skins" data-help="skin-gallery.grid">
          {skins.map((s) => (
            <Button key={s.id} tone="quiet" className={`axp-skin-gallery__card${s.id === picked ? ' is-picked' : ''}`} role="option" aria-selected={s.id === picked} title={s.description} data-skin={s.id} onClick={() => setPicked(s.id === picked ? '' : s.id)}>
              <strong>{s.name}</strong>
              <span className="fx-muted">{s.kind === 'design-package' ? 'Design package' : s.iconPack ? `Icons: ${s.iconPack}` : 'Skin'}</span>
              <span className="fx-muted">Covers {s.coverage?.covered ?? 0} of {s.coverage?.total ?? 0} asset types{s.parts.length ? ` · styles ${s.parts.length} part(s)` : ''}</span>
              {s.inForceAt.length > 0 && <Chip tone="accent">In use: {s.inForceAt.map(scopeLabel).join(', ')}</Chip>}
            </Button>
          ))}
        </div>
        <SkinPreview skin={current} fallback={inForceName} frame={frame} onFrame={setFrame} />
      </div>
    </SkinScope>
  );
}
