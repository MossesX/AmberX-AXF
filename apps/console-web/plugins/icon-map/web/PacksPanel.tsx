/**
 * Packs are assets: the pack library (every icon-pack@1 the app has, shipped or imported, with a preview drawn from
 * the pack itself), per-skin default packs, import (paste an asset or a template), export, and sharing through
 * axHub's shared icon-pack table. Every button dispatches the plugin's console actions, so REST, MCP, the CLI and
 * voice take the same path.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Container, SelectField, TextField, useRuntime } from '@console/axf/react';
import { glyphSvg } from '@console/axf/core';
import { EmptyState } from '@console/emptyState';
import { CHANGED, get, type State } from './shared';

const PREVIEW = ['home', 'settings', 'search', 'save', 'bell', 'badge-dot', 'logo-mark'];
const FILTERS = [
  { value: '', label: 'Every pack' }, { value: 'themable', label: 'Themable' }, { value: 'fixed', label: 'Fixed colour' },
  { value: 'icons', label: 'Icons' }, { value: 'badges', label: 'Badges' }, { value: 'logos', label: 'Logos' }, { value: 'imported', label: 'Imported' },
];

interface Row { id: string; name: string; style: string; themable: boolean; covers: string[]; license: string; imported: boolean; data: unknown }

function Preview({ data }: { data: unknown }) {
  const g = ((data ?? {}) as { glyphs?: Record<string, unknown> }).glyphs ?? {};
  const names = PREVIEW.filter((n) => n in g).slice(0, 4);
  return (
    <span className="axp-icon-map__swatch" aria-hidden="true">
      {names.map((n) => <span key={n} className="axp-icon-map__swatch-glyph" dangerouslySetInnerHTML={{ __html: glyphSvg(data, n, 20) ?? '' }} />)}
    </span>
  );
}

export function PacksPanel() {
  const rt = useRuntime();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const [filter, setFilter] = useState('');
  const [find, setFind] = useState('');
  const [paste, setPaste] = useState('');
  useEffect(() => { const on = () => setTick((n) => n + 1); window.addEventListener(CHANGED, on); return () => window.removeEventListener(CHANGED, on); }, []);
  useEffect(() => { void get<State>('state').then(setState, () => setState(null)); }, [tick]);
  const active = rt.iconPackId();
  const rows: Row[] = useMemo(() => rt.registry.all().filter((a) => a.type === 'icon-pack').map((a) => {
    const d = (a.data ?? {}) as { style?: string; themable?: boolean; covers?: string[]; license?: { name?: string } | string };
    return { id: a.id, name: a.name || a.id, style: d.style ?? 'outline', themable: d.themable !== false, covers: d.covers ?? ['icons'], license: typeof d.license === 'string' ? d.license : d.license?.name ?? '', imported: rt.registry.sourceOf('icon-pack', a.id) === 'imported', data: a.data };
  }).sort((a, b) => a.name.localeCompare(b.name)), [rt, tick]);
  const words = find.trim().toLowerCase();
  const shown = rows.filter((r) => (!filter || (filter === 'themable' ? r.themable : filter === 'fixed' ? !r.themable : filter === 'imported' ? r.imported : r.covers.includes(filter)))
    && (!words || `${r.id} ${r.name} ${r.style}`.toLowerCase().includes(words)));
  const skins = rt.skinList().filter((k) => k.kind === 'skin');
  const skinPacks = state?.skinPacks ?? {};
  const hub = state?.hubPacks ?? [];
  const packOptions = rows.map((r) => ({ value: r.id, label: `${r.name}${r.themable ? '' : ' · fixed colour'}` }));
  const doImport = () => { if (paste.trim()) { rt.dispatch(`icon-map.pack.import:${paste.trim()}`); setPaste(''); } };

  return (
    <>
      <Container title="Pack library" icon="package">
        <div className="fx-stack">
          <div className="axp-icon-map__bar" role="toolbar" aria-label="Pack library">
            <div className="axp-icon-map__grow"><TextField label="Find a pack" value={find} onChange={(v: string) => setFind(v)} placeholder="phosphor, material, badges, duotone…" /></div>
            <SelectField label="Show" value={filter} onChange={(v: string) => setFilter(v)} options={FILTERS} />
          </div>
          <p className="axp-icon-map__summary">{rows.length} packs: {rows.filter((r) => r.themable).length} themable (follow the skin's colour and stroke), {rows.filter((r) => !r.themable).length} fixed colour, {rows.filter((r) => r.imported).length} imported.</p>
          {!shown.length ? <EmptyState icon="search">No pack matches.</EmptyState> : (
            <ul className="axp-icon-map__list">
              {shown.map((r) => (
                <li key={r.id} className={`axp-icon-map__row${r.id === active ? ' is-picked' : ''}`}>
                  <Preview data={r.data} />
                  <div className="axp-icon-map__text">
                    <span className="axp-icon-map__id">{r.name}{r.id === active ? ' (in force)' : ''}</span>
                    <span className="axp-icon-map__where">{r.id} · {r.style} · {r.themable ? 'themable' : 'fixed colour'} · {r.covers.join(', ')}{r.license ? ` · ${r.license}` : ''}{r.imported ? ' · imported' : ''}</span>
                  </div>
                  <div className="axp-icon-map__actions">
                    <Button size="sm" tone={r.id === active ? 'primary' : 'neutral'} icon="check" onClick={() => rt.dispatch(`icon-map.pack.use:${r.id}`)} aria-label={`Use ${r.name}`}>Use</Button>
                    <Button size="sm" icon="download" onClick={() => rt.dispatch(`icon-map.pack.export:${r.id}`)} aria-label={`Export ${r.name}`}>Export</Button>
                    <Button size="sm" icon="cloud" onClick={() => rt.dispatch(`icon-map.pack.share:${r.id}`)} aria-label={`Share ${r.name} on axHub`}>Share</Button>
                    {r.imported ? <Button size="sm" icon="trash" onClick={() => rt.dispatch(`icon-map.pack.remove:${r.id}`)} aria-label={`Remove ${r.name}`}>Remove</Button> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Container>

      <Container title="Per-skin defaults" icon="palette">
        <div className="fx-stack">
          <p className="axp-icon-map__summary">The pack each skin draws while no pack is picked by hand. Blank follows the pack the skin names itself.</p>
          {skins.length ? (
            <ul className="axp-icon-map__list">
              {skins.map((k) => {
                const own = typeof k.data?.iconPack === 'string' ? k.data.iconPack : '';
                return (
                  <li key={k.id} className="axp-icon-map__row axp-icon-map__row--two">
                    <div className="axp-icon-map__text"><span className="axp-icon-map__id">{k.name}</span><span className="axp-icon-map__where">{k.id} · names {own || 'the branding pack'}</span></div>
                    <SelectField label={`${k.name} default pack`} value={skinPacks[k.id] ?? ''} onChange={(v: string) => rt.dispatch(v ? `icon-map.skin.pack:${k.id}:${v}` : `icon-map.skin.clear:${k.id}`)} options={[{ value: '', label: `The skin's own (${own || 'branding'})` }, ...packOptions]} />
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState icon="palette">No skins in this app.</EmptyState>}
        </div>
      </Container>

      <Container title="Import and share" icon="upload">
        <div className="fx-stack">
          <TextField label="Paste a pack" rows={6} mono value={paste} onChange={(v: string) => setPaste(v)} placeholder='{ "$axf": "asset@1", "type": "icon-pack", … } (Download template gives one with every role)' />
          <div className="axp-icon-map__bar" role="toolbar" aria-label="Import and share">
            <Button tone="primary" icon="upload" disabled={!paste.trim()} onClick={doImport}>Import pack</Button>
            <Button icon="download" onClick={() => rt.dispatch('icon-map.template')}>Download template</Button>
            <Button icon="refresh" onClick={() => rt.dispatch('icon-map.hub.refresh')}>Read axHub</Button>
          </div>
          <p className="axp-icon-map__summary">Shared on axHub: {hub.length ? hub.length : 'none read yet'}. Share puts a pack in axHub's shared icon-pack table for every app on the project; Take brings one in as an imported pack.</p>
          {hub.length ? (
            <ul className="axp-icon-map__list">
              {hub.map((h) => (
                <li key={h.id} className="axp-icon-map__row axp-icon-map__row--two">
                  <div className="axp-icon-map__text"><span className="axp-icon-map__id">{h.name}</span><span className="axp-icon-map__where">{h.id} · {h.style} · {h.themable ? 'themable' : 'fixed colour'}{h.by ? ` · by ${h.by}` : ''}</span></div>
                  <Button size="sm" icon="download" onClick={() => rt.dispatch(`icon-map.pack.fromhub:${h.id}`)} aria-label={`Take ${h.name} from axHub`}>Take</Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Container>
    </>
  );
}
