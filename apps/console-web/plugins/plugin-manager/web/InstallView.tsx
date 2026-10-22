/**
 * Install view: the plugin catalog on axHub (plugin-catalog@1, /projects/_shared/_data/plugin-catalog).
 * Console plugins install here (unpacked into this clone, lifecycle install, committed to GitHub so the console
 * rebuilds with them); plugins for other apps (Build Pilot) are listed so they can be shared or taken out, and are
 * installed from those apps. Any console plugin in this clone can be published to the catalog.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Icon, Segmented, useRuntime } from '@console/axf/react';
import { getToken, post } from '@console/api';
import { PLUGINS_CHANGED } from '@console/plugins';
import type { ViewProps } from './views';

export interface CatalogItem {
  kind: string; folder: string; id: string; name: string; version: string; description?: string; author?: string;
  stacks?: string[]; requires?: string[]; provides?: string[]; bytes: number; files: number; publishedAt: string; publishedFrom?: string;
  versions?: string[]; installed?: string | null; clash?: boolean; loaded?: boolean;
}
interface CatalogList { reachable: boolean; updatedAt: string | null; kinds: Record<string, string>; items: CatalogItem[] }

async function loadCatalog(): Promise<CatalogList> {
  const t = getToken();
  const r = await fetch('/api/plugin-catalog', { cache: 'no-store', headers: t ? { authorization: `Bearer ${t}` } : {} });
  const j = (await r.json().catch(() => ({}))) as CatalogList & { detail?: string };
  if (!r.ok) throw new Error(r.status === 401 ? 'Set the console token to see the plugin catalog.' : j.detail ?? `catalog unavailable (${r.status})`);
  return j;
}

/** Compare a.b.c versions (pre-release tags ignored for ordering). */
export function newer(a: string, b: string): boolean {
  const pa = (a.split(/[-+]/)[0] ?? '').split('.').map(Number), pb = (b.split(/[-+]/)[0] ?? '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type Ask = { kind: 'install' | 'update' | 'remove'; item: CatalogItem } | null;

export function InstallView({ inv, onChanged }: ViewProps) {
  const rt = useRuntime();
  const [cat, setCat] = useState<CatalogList | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState('console');
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState<Ask>(null);
  const [typed, setTyped] = useState('');
  const [share, setShare] = useState('');
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    try { setCat(await loadCatalog()); setError(''); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const items = useMemo(() => (cat?.items ?? []).filter((i) => i.kind === kind), [cat, kind]);
  const kinds: [string, string][] = cat ? Object.entries(cat.kinds) : [['console', 'Dev Console plugin']];
  const local = inv.items.filter((r) => !r.folder.startsWith('_'));

  const run = async () => {
    if (!ask) return;
    const { item } = ask;
    setBusy(item.folder); setNote('');
    const r = ask.kind === 'remove'
      ? await post('plugin-catalog/remove', { kind: item.kind, folder: item.folder, confirm: typed })
      : await post('plugin-catalog/install', { folder: item.folder, update: ask.kind === 'update', confirm: typed });
    setBusy('');
    if (!r.ok) { rt.toast(String(r.error ?? 'It did not work.'), 'danger', 'Plugin catalog'); return; }
    setAsk(null); setTyped('');
    if (ask.kind === 'remove') rt.toast(`${item.name} is no longer in the catalog.`, 'success', 'Plugin catalog');
    else {
      const msg = String((r as { note?: string }).note ?? '');
      setNote(`${item.name} ${item.version} ${ask.kind === 'update' ? 'updated' : 'installed'}. ${msg}`);
      rt.toast(`${item.name} ${ask.kind === 'update' ? 'updated' : 'installed'}.`, 'success', 'Plugin catalog');
      globalThis.dispatchEvent(new Event(PLUGINS_CHANGED));
      onChanged();
    }
    void reload();
  };

  const publish = async () => {
    if (!share) return;
    setBusy(`share:${share}`);
    const r = await post('plugin-catalog/publish', { folder: share, from: 'plugin manager' });
    setBusy('');
    if (!r.ok) { rt.toast(String(r.error ?? 'Could not publish it.'), 'danger', 'Plugin catalog'); return; }
    const it = (r as { item?: CatalogItem; published?: boolean }).item;
    rt.toast((r as { published?: boolean }).published ? `${it?.name} ${it?.version} is in the catalog.` : `${it?.name} ${it?.version} was already in the catalog.`, 'success', 'Plugin catalog');
    setShare('');
    void reload();
  };

  return (
    <div className="axp-plugin-manager-install fx-stack">
      <div className="fx-row fx-row--wrap axp-plugin-manager-install__head">
        <div className="fx-stack">
          <strong><Icon name="download" size={14} /> Plugin catalog</strong>
          <span className="fx-muted fx-small">Kept on axHub (/projects/_shared/_data/plugin-catalog), shared by every app.{cat?.updatedAt ? ` Updated ${new Date(cat.updatedAt).toLocaleString()}.` : ''}</span>
        </div>
        <Segmented label="Plugins for" value={kind} onChange={(k) => setKind(k)}
          options={kinds.map(([k, label]) => ({ value: k, label: <span>{k === 'console' ? 'This console' : label.replace(/ plugin$/, '')}</span> }))} />
        <Button tone="ghost" icon="refresh" onClick={() => void reload()}>Refresh</Button>
      </div>
      {error && <p className="axp-plugin-manager-offline"><Icon name="cloud" size={14} /> {error}</p>}
      {cat && !cat.reachable && <p className="axp-plugin-manager-offline"><Icon name="cloud" size={14} /> The catalog isn't reachable from this console: it needs the axhub-projects volume mounted at /projects (deploy/install-console.sh does that).</p>}
      {note && <p className="axp-plugin-manager-install__note">{note}</p>}
      {kind !== 'console' && <p className="fx-muted fx-small">These plugins are installed from their own app (e.g. Build Pilot → Plugins → Install). Here you can see and take them out of the catalog.</p>}

      {cat?.reachable && items.length === 0 && <p className="fx-muted">Nothing in the catalog for {kind === 'console' ? 'the console' : kinds.find(([k]) => k === kind)?.[1] ?? kind} yet.{kind === 'console' ? ' Publish one below.' : ''}</p>}
      <ul className="axp-plugin-manager-install__list">
        {items.map((it) => {
          const state = it.clash ? 'clash' : !it.installed ? 'new' : newer(it.version, it.installed) ? 'update' : 'current';
          return (
            <li key={`${it.kind}:${it.folder}`} className="fx-card axp-plugin-manager-install__item">
              <div className="fx-stack">
                <div className="fx-row fx-row--wrap">
                  <strong>{it.name}</strong>
                  <span className="fx-muted fx-small">{it.version} · {it.folder}</span>
                  {kind === 'console' && (
                    state === 'current' ? <Chip tone="success">installed</Chip>
                      : state === 'update' ? <Chip tone="warning">{`installed ${it.installed}`}</Chip>
                        : state === 'clash' ? <Chip tone="danger">folder taken</Chip> : null
                  )}
                  {it.stacks?.length ? <Chip>{it.stacks.includes('*') ? 'all stacks' : it.stacks.join(', ')}</Chip> : null}
                </div>
                {it.description && <p className="fx-small">{it.description}</p>}
                <span className="fx-muted fx-small">
                  {[it.author && `by ${it.author}`, `${it.files} files, ${kb(it.bytes)}`, `published ${new Date(it.publishedAt).toLocaleDateString()}`, it.publishedFrom && `from ${it.publishedFrom}`, it.requires?.length && `needs ${it.requires.join(', ')}`].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="fx-row fx-row--wrap">
                {kind === 'console' && state === 'new' && <Button tone="primary" icon="download" disabled={!!busy} onClick={() => { setAsk({ kind: 'install', item: it }); setTyped(''); }}>Install</Button>}
                {kind === 'console' && state === 'update' && <Button tone="primary" icon="download" disabled={!!busy} onClick={() => { setAsk({ kind: 'update', item: it }); setTyped(''); }}>Update to {it.version}</Button>}
                <Button tone="ghost" icon="trash" disabled={!!busy} onClick={() => { setAsk({ kind: 'remove', item: it }); setTyped(''); }}>Take out</Button>
              </div>
              {ask?.item === it && (
                <div className="axp-plugin-manager-install__confirm fx-stack" role="alertdialog" aria-label={`${ask.kind} ${it.name}`}>
                  <p className="fx-small">
                    {ask.kind === 'remove'
                      ? <>Take <strong>{it.name}</strong> out of the catalog? Apps that installed it keep it; nobody can install it from here until it's published again.</>
                      : <>{ask.kind === 'update' ? 'Update' : 'Install'} <strong>{it.name} {it.version}</strong>? Its code runs on this console's server. It's committed to the repo on GitHub, and the console rebuilds with it within about 5 minutes. Only install plugins you trust.</>}
                  </p>
                  <label className="fx-small">Type <code>{it.folder}</code> to confirm
                    <input className="fx-input" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Folder name to confirm" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                  </label>
                  <div className="fx-row fx-row--wrap">
                    <Button tone={ask.kind === 'remove' ? 'danger' : 'primary'} disabled={typed !== it.folder || !!busy} onClick={() => void run()}>
                      {busy === it.folder ? 'Working…' : ask.kind === 'remove' ? 'Take it out' : ask.kind === 'update' ? 'Update' : 'Install'}
                    </Button>
                    <Button tone="ghost" onClick={() => setAsk(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {kind === 'console' && (
        <section className="fx-card axp-plugin-manager-install__share fx-stack">
          <strong>Publish a plugin to the catalog</strong>
          <span className="fx-muted fx-small">Packs a plugin from this console (no data, no secrets) so other consoles can install it. A version can't change once published: raise the version in its plugin.json first.</span>
          <div className="fx-row fx-row--wrap">
            <select className="fx-input axp-plugin-manager-select" value={share} onChange={(e) => setShare(e.target.value)} aria-label="Plugin to publish">
              <option value="">Pick a plugin…</option>
              {local.map((r) => <option key={r.folder} value={r.folder}>{r.name} ({r.version})</option>)}
            </select>
            <Button tone="primary" icon="upload" disabled={!share || !!busy || !cat?.reachable} onClick={() => void publish()}>{busy.startsWith('share:') ? 'Publishing…' : 'Publish'}</Button>
          </div>
          <span className="fx-muted fx-small">Build Pilot plugins are published from a Build-Pilot clone: <code>AXF_TOKEN=… node framework/cli/plugin-catalog.mjs publish ../build-pilot/plugins/&lt;folder&gt; --kind pilot --console https://console.amberxai.com</code></span>
        </section>
      )}
    </div>
  );
}
