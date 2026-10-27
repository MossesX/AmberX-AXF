/**
 * Plugins from axHub: browse the plugin catalog on axHub and install, update or remove AmberX plugins without the Dev
 * Console (axHub decision 101).
 *
 * AmberX is one compiled site, so a plugin is "installed" when its folder is in the repo and the site has rebuilt
 * (every 5 minutes from main). This page lists the catalog with your hub session and, for Install / Update / Remove,
 * opens axHub's own confirm page (`#/plugins/install/amberx/<folder>`): the hub checks the package and writes it as one
 * commit with the vault's GitHub token, and only takes that from you, signed in on the hub's page. This app never holds
 * a token and never writes to GitHub.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Chip, Container, Note, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { HUB } from '../../../hub/useHub';
import { native } from '../../../native';
import { registerVoiceCommands } from '../../voice/web';
import { MARK_LABEL, catalogUrl, installUrl, interpretFeed, storeOrder, type Mark, type StoreFeed } from './core';

const ID = 'ai.amberx.amberx.plugin-store';

/* ---------------------------------------------------------------- the catalog (one copy for the page) */

type State = { loading: boolean; feed: StoreFeed | null; at: number };
let state: State = { loading: false, feed: null, at: 0 };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
const useStore = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);

/** Reads `/plugins.json` with the hub session (no token; redirects refused, never cached, 10 s). */
export async function loadCatalog(): Promise<StoreFeed> {
  if (state.loading) return state.feed ?? interpretFeed(0, '');
  set({ loading: true });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  let feed: StoreFeed;
  try {
    const r = await fetch(`${HUB}/plugins.json?kind=amberx`, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: ctl.signal, headers: { Accept: 'application/json' } });
    feed = interpretFeed(r.status, await r.text());
  } catch {
    feed = interpretFeed(0, '');
  } finally {
    clearTimeout(timer);
  }
  set({ loading: false, feed, at: Date.now() });
  return feed;
}

/** Plugin id → version for everything this build runs (the shell's own and every installed plugin). */
const installedOf = (rt: AxfRuntime) => new Map(rt.libraries.map((l) => [l.id, l.version] as const));

function openOnHub(rt: AxfRuntime, url: string | null) {
  if (!url) { rt.toast("This build's hub address can't make that link.", 'danger', 'Plugins'); return; }
  void native.hubOpen({ url }).catch(() => rt.toast("Couldn't open axHub.", 'danger', 'Plugins'));
}

const BUTTON: Record<Mark, { label: string; tone: 'primary' | 'neutral'; icon: string }> = {
  new: { label: 'Install', tone: 'primary', icon: 'download' },
  update: { label: 'Update', tone: 'primary', icon: 'refresh' },
  installed: { label: 'Manage', tone: 'neutral', icon: 'settings' },
  'newer-here': { label: 'Manage', tone: 'neutral', icon: 'settings' },
};
const TONE: Record<Mark, 'success' | 'warning' | 'accent' | undefined> = { installed: 'success', update: 'warning', new: undefined, 'newer-here': 'accent' };

/* ---------------------------------------------------------------- view */

function StoreView() {
  const rt = useRuntime();
  const s = useStore();
  useEffect(() => {
    void loadCatalog();
    // Back from axHub's confirm page (or the app came forward): read the catalog again.
    const back = () => { if (document.visibilityState === 'visible') void loadCatalog(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);
  const feed = s.feed;
  const list = feed?.state === 'ok' ? storeOrder(feed.items, installedOf(rt)) : [];
  const updates = list.filter((x) => x.mark === 'update').length;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugins from axHub</p>
          <h1>{feed?.state === 'ok' ? `${list.length} plugin${list.length === 1 ? '' : 's'}${updates ? ` · ${updates} update${updates === 1 ? '' : 's'}` : ''}` : 'Plugin catalog'}</h1>
          <p className="fx-muted">Tap Install and confirm on axHub. AmberX picks the plugin up when its site rebuilds, about 5 minutes later.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" disabled={s.loading} onClick={() => void loadCatalog()}>{s.loading ? 'Checking…' : 'Check again'}</Button>
          <Button icon="external" onClick={() => openOnHub(rt, catalogUrl(HUB))}>Open on axHub</Button>
        </div>
      </header>
      {!feed && s.loading && <p className="fx-muted">Reading the catalog…</p>}
      {feed && feed.state !== 'ok' && (
        <Note tone={feed.state === 'signed-out' || feed.state === 'not-admin' ? 'warning' : 'danger'} icon="alert">
          <div className="fx-stack">
            <span>{feed.message}</span>
            {feed.state === 'signed-out' && <div className="fx-row"><Button size="sm" tone="primary" icon="key" onClick={() => openOnHub(rt, `${new URL(HUB).origin}/auth/login`)}>Sign in to axHub</Button></div>}
          </div>
        </Note>
      )}
      {feed?.state === 'ok' && !feed.target && <Note tone="warning">axHub isn't set up to install AmberX plugins (AXHUB_PLUGIN_TARGETS on the hub).</Note>}
      {feed?.state === 'ok' && !feed.reachable && <Note tone="warning">axHub can't see the plugin catalog right now.</Note>}
      {feed?.state === 'ok' && feed.reachable && list.length === 0 && <p className="fx-muted">No AmberX plugins are published yet. Publish one from the Dev Console (plugin catalog, kind amberx).</p>}
      {list.map((it) => {
        const b = BUTTON[it.mark];
        return (
          <Container key={it.folder} title={it.name} icon="package" actions={<Chip tone={TONE[it.mark]}>{MARK_LABEL[it.mark]}</Chip>}>
            <div className="fx-stack">
              {it.description && <p>{it.description}</p>}
              <p className="fx-muted">{it.version}{it.model ? ` · built with ${it.model}` : ''} · {it.files} file{it.files === 1 ? '' : 's'}</p>
              <div className="fx-row"><Button size="sm" tone={b.tone} icon={b.icon} onClick={() => openOnHub(rt, installUrl(HUB, it.folder))}>{b.label}</Button></div>
            </div>
          </Container>
        );
      })}
      {feed?.state === 'ok' && (
        <Note tone="info" icon="info">
          <div className="fx-stack">
            <span>Just installed something? Once the site has rebuilt, reload AmberX to load it.</span>
            <div className="fx-row"><Button size="sm" icon="refresh" onClick={() => location.reload()}>Reload AmberX</Button></div>
          </div>
        </Note>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- library */

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Plugins from axHub',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-27' },
  dependsOn: ['ai.amberx.amberx.voice'],
  provides: ['amberx.plugin-store'],
  views: { 'plugin-store': { title: 'Plugins from axHub', icon: 'package', keywords: ['plugins', 'install', 'store', 'catalog', 'axhub', 'update'], render: () => <StoreView /> } },
  nav: { label: 'Plugins', items: [{ id: 'plugin-store', label: 'Get plugins', icon: 'package', view: 'plugin-store' }] },
  appMenu: [{ id: 'amberx.plugin-store', menu: 'axhub', items: [{ id: 'plugin-store.open', label: 'Plugins from axHub', icon: 'package', action: 'nav:plugin-store' }] }],
  contextMenu: [{ id: 'amberx.plugin-store', items: [{ id: 'plugin-store.open', label: 'Get plugins', icon: 'package', action: 'nav:plugin-store' }] }],
  register(rt) {
    rt.actions.register('plugin-store.check', () => void loadCatalog().then((f) => {
      if (f.state !== 'ok') { rt.toast(f.message, 'warning', 'Plugins'); return; }
      const n = storeOrder(f.items, installedOf(rt)).filter((x) => x.mark === 'update').length;
      rt.toast(n ? `${n} plugin update${n === 1 ? '' : 's'} on axHub.` : 'Every plugin is current.', n ? 'info' : 'success', 'Plugins');
    }), { label: 'Check axHub for plugin updates' });
    registerVoiceCommands(ID, [
      { id: 'plugins.open', phrases: ['get plugins', 'install a plugin', 'install plugins', 'plugin store', 'open plugins'], action: 'nav:plugin-store', reply: 'Here are the plugins on axHub.' },
      { id: 'plugins.check', phrases: ['check for plugin updates', 'any plugin updates', 'update plugins'], action: 'plugin-store.check' },
    ]);
  },
};
