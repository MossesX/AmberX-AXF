/**
 * Where the buttons switch: the whole hub, one app, one screen (ui:<view>) or one plugin (plugin:<id>). Apps come from
 * the plugin's apps route, screens and plugins from the console's library registry (rt.libraries). Shows the skin in
 * force and the level it comes from, with the Inherit / Follow hub switch of the scope.
 */
import { useEffect, useMemo, useState } from 'react';
import { Container, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import { listApps, scopeLabel, type AppRow, type ScopeView, type SkinRow } from './api';

export type Kind = 'hub' | 'app' | 'ui' | 'plugin';
export const KINDS: { value: Kind; label: string; icon: string }[] = [
  { value: 'hub', label: 'Hub', icon: 'cloud' },
  { value: 'app', label: 'App', icon: 'monitor' },
  { value: 'ui', label: 'Screen', icon: 'layout' },
  { value: 'plugin', label: 'Plugin', icon: 'box' },
];
export const kindOf = (scope: string): Kind => (scope.startsWith('ui:') ? 'ui' : scope.startsWith('plugin:') ? 'plugin' : scope === 'hub' ? 'hub' : 'app');
export const scopeOf = (kind: Kind, target: string) => (kind === 'hub' ? 'hub' : kind === 'app' ? 'app' : target ? `${kind}:${target}` : '');

interface Props {
  kind: Kind;
  target: string;
  app: string;
  known: string[];
  view: ScopeView | null;
  skins: SkinRow[];
  busy: boolean;
  onKind: (k: Kind) => void;
  onTarget: (t: string) => void;
  onApp: (a: string) => void;
  onFollow: (on: boolean) => void;
}

export function ScopePicker({ kind, target, app, known, view, skins, busy, onKind, onTarget, onApp, onFollow }: Props) {
  const rt = useRuntime();
  const [apps, setApps] = useState<AppRow[]>([]);
  useEffect(() => { void listApps().then(setApps, () => undefined); }, []);
  const libs = rt.libraries as unknown as { id: string; label: string; ui?: { views: { id: string; title?: string }[] } }[];
  const options = useMemo(() => {
    const saved = known.filter((s) => s.startsWith(`${kind}:`)).map((s) => s.slice(kind.length + 1));
    const reg = kind === 'ui'
      ? libs.flatMap((l) => (l.ui?.views ?? []).map((v) => ({ value: v.id, label: `${v.title ?? v.id} (${l.label})` })))
      : kind === 'plugin' ? libs.map((l) => ({ value: l.id, label: l.label })) : [];
    const ids = new Set(reg.map((o) => o.value));
    return [...reg, ...saved.filter((s) => !ids.has(s)).map((s) => ({ value: s, label: `${s} (saved)` }))];
  }, [kind, known, libs]);

  const name = (id: string) => skins.find((s) => s.id === id)?.name ?? id;
  const inherits = view?.state.use === 'inherit';
  const followLabel = kind === 'app' ? 'Follow hub' : 'Inherit from parent';
  return (
    <Container title="Where to switch" icon="target" className="axp-skin-gallery__scope">
      <TabGroup id="skin-gallery.scope" label="Scope" value={kind} onChange={(v) => onKind(v as Kind)} tabs={KINDS} />
      <div className="axp-skin-gallery__target" data-help="skin-gallery.scope">
        {kind === 'app' && (
          <SelectField label="App" value={app} empty="This console" options={apps.map((a) => ({ value: a.id, label: a.look ? a.id : `${a.id} (no look yet)` }))} onChange={onApp} />
        )}
        {(kind === 'ui' || kind === 'plugin') && (
          <>
            <SelectField label={kind === 'ui' ? 'Screen' : 'Plugin'} value={target} empty="Pick one…" options={options} onChange={onTarget} />
            <TextField label="Or type its id" value={target} onChange={onTarget} placeholder={kind === 'ui' ? 'home' : 'ai.amberx.axf.console.notes'} mono />
          </>
        )}
      </div>
      <p className="fx-muted axp-skin-gallery__now" data-axf-skin-inforce="">
        {view
          ? <>In force at {scopeLabel(view.scope)}: <strong>{view.inForce.id ? name(view.inForce.id) : 'no skin'}</strong>, from {scopeLabel(view.inForce.from)}{view.overridden.length ? ` · ${view.overridden.length} change(s) on top` : ''}</>
          : kind === 'hub' || kind === 'app' ? 'Reading…' : `Pick the ${kind === 'ui' ? 'screen' : 'plugin'} first.`}
      </p>
      {kind !== 'hub' && view && (
        <Switch label={followLabel} checked={inherits} disabled={busy} onChange={onFollow}
          hint={inherits ? `Shows what ${kind === 'app' ? 'the hub' : 'its parent'} shows.` : `Keeps its own skin; on, it ${kind === 'app' ? 'follows the hub-wide skin' : 'follows its parent'}.`} />
      )}
    </Container>
  );
}
