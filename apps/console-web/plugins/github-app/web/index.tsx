/**
 * GitHub App console plugin (ai.amberx.axf.console.github-app, github-app@1).
 *
 * Settings → Plugins → GitHub: three taps replace the personal tokens that kept dying.
 *   1. Create GitHub App — the console builds a GitHub App manifest and posts it to github.com (personal account);
 *      GitHub comes back to /?ghapp=created and the server stores the app's credentials (never in the browser).
 *   2. Install — GitHub's install page (pick All repositories); back at /?ghapp=installed the installation is found.
 *   3. Authorize as Brett — a user token from the same app (refreshed by itself) for creating repos.
 * The browser only ever sees ids, names, expiry times and check results; tokens and keys stay on the server.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Note, Section, TextField } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.github-app';
const FOLDER = 'github-app';
const TAB = 'github-app';
const RETURN_KEY = 'axf.github-app.return';
const STEPS = ['created', 'installed', 'authorized'];
const api = pluginApi(FOLDER, 'The GitHub plugin');

interface Check { ok: boolean; why?: string; state?: string; problems?: string[]; [k: string]: unknown }
interface AppInfo { appId: number; slug: string; name: string; owner: string; htmlUrl: string; installationId: number | null; installationAccount: string; repositorySelection: string; installUrl: string }
interface Status { configured: boolean; app: AppInfo | null; checks: Record<string, Check>; legacy: { set: boolean } }
interface Keeper { source: 'app' | 'legacy' | 'none'; at: number | null }
interface Listing { status: Status; keeper: Keeper }
interface Return { step: string; code?: string; state?: string; installationId?: string }

const time = (iso?: unknown) => (typeof iso === 'string' && iso ? new Date(iso).toLocaleString() : '');

/** On the way back from github.com: keep what it sent for the settings panel, clean the address bar, open the tab. */
function catchReturn(rt: AxfRuntime): void {
  if (typeof window === 'undefined') return;
  const q = new URLSearchParams(window.location.search);
  const step = q.get('ghapp') ?? '';
  if (!STEPS.includes(step)) return;
  const back: Return = { step, code: q.get('code') ?? undefined, state: q.get('state') ?? undefined, installationId: q.get('installation_id') ?? undefined };
  sessionStorage.setItem(RETURN_KEY, JSON.stringify(back));
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  window.setTimeout(() => rt.dispatch(`settings.open:${TAB}`), 400);
}

/** POSTs the manifest to github.com from a plain form (GitHub's manifest flow needs a browser form post). */
function postManifest(action: string, manifest: unknown): void {
  const f = document.createElement('form');
  f.method = 'post';
  f.action = action;
  const i = document.createElement('input');
  i.type = 'hidden';
  i.name = 'manifest';
  i.value = JSON.stringify(manifest);
  f.appendChild(i);
  document.body.appendChild(f);
  f.submit();
}

function CheckRow({ label, c, ok }: { label: string; c?: Check; ok: string }) {
  if (!c) return null;
  return (
    <li className="fx-row fx-row--wrap">
      <Chip tone={c.ok ? 'success' : c.state === 'none' ? 'warning' : 'danger'}>{c.ok ? 'OK' : c.state === 'none' ? 'Not yet' : 'Broken'}</Chip>
      <span>{label}</span>
      <span className="fx-muted fx-small">{c.ok ? ok : (c.why ?? (c.problems ?? []).join('; ') ?? '')}</span>
    </li>
  );
}

function GitHubAppPanel() {
  const [data, setData] = useState<Listing | null>(null);
  const [name, setName] = useState('AmberX AXF Bot');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true); setError('');
    try { return await fn(); } catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  };
  const load = (live = false) => run(async () => { const d = await api.call<Listing>(`status${live ? '?live=true' : ''}`); setData(d); return d; });

  useEffect(() => {
    const raw = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    const back: Return | null = raw ? JSON.parse(raw) as Return : null;
    const origin = window.location.origin;
    void (async () => {
      if (back?.step === 'created' && back.code) {
        const r = await run(() => api.post<{ app: AppInfo; next: string }>('convert', { code: back.code, state: back.state, origin }));
        if (r?.next) { setDone(`${r.app.name} created. Next: install it on All repositories.`); window.location.assign(r.next); return; }
      } else if (back?.step === 'installed') {
        const r = await run(() => api.post<{ installation: { id: number } | null }>('installation', { id: back.installationId }));
        if (r) setDone(r.installation ? 'Installed: the console now mints its own GitHub tokens.' : 'GitHub sent you back, but no installation was found yet. Tap Check installation.');
      } else if (back?.step === 'authorized' && back.code) {
        const r = await run(() => api.post<{ user: { login: string } }>('authorized', { code: back.code, state: back.state, origin }));
        if (r) setDone(`Authorized as ${r.user.login || 'you'}: repo creation works and the token renews by itself.`);
      }
      await load(!!back);
    })();
  }, []);

  const create = () => run(async () => {
    const r = await api.post<{ action: string; manifest: unknown }>('manifest', { origin: window.location.origin, name });
    postManifest(r.action, r.manifest);
  });
  const authorize = () => run(async () => { const r = await api.post<{ url: string }>('authorize', { origin: window.location.origin }); window.location.assign(r.url); });
  const act = (path: string, body: unknown = {}) => run(async () => { await api.post(path, body); await load(true); });

  const s = data?.status;
  const app = s?.app;
  const c = s?.checks ?? {};
  const installed = !!app?.installationId;
  const user = c.user;
  const source = data?.keeper.source ?? 'none';

  return (
    <div className="fx-stack" data-axf-github-app>
      <div className="fx-row fx-row--wrap">
        <Chip tone={source === 'app' ? 'success' : source === 'legacy' ? 'warning' : 'danger'}>
          {source === 'app' ? 'GitHub runs on the app' : source === 'legacy' ? 'GitHub runs on the old personal token' : 'No GitHub token'}
        </Chip>
        {s?.legacy.set && <Chip>Old token kept as fallback</Chip>}
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => void load(true)}>Check now</Button>
      </div>
      {done && <Note tone="success">{done}</Note>}
      {error && <Note tone="danger">{error}</Note>}

      <Section title="1. Create GitHub App">
        {app ? (
          <p className="fx-small" style={{ margin: 0 }}>
            <strong>{app.name}</strong> <span className="fx-muted">({app.slug}, app id {app.appId}, owner {app.owner})</span>{' '}
            <a href={app.htmlUrl} target="_blank" rel="noreferrer">Open on GitHub</a>
          </p>
        ) : (
          <div className="fx-stack fx-stack--sm">
            <p className="fx-small fx-muted" style={{ margin: 0 }}>Makes a private GitHub App on MossesX with Administration, Contents, Pull requests, Actions, Workflows and Issues (read and write), Checks and Commit statuses (read). GitHub shows a page with one button: <strong>Create GitHub App</strong>.</p>
            <TextField label="App name" value={name} onChange={setName} hint="If GitHub says the name is taken, add a suffix (e.g. AmberX AXF Bot 2) and tap Create again." />
            <div className="fx-row"><Button tone="primary" icon="plus" disabled={busy || !name.trim()} onClick={() => void create()}>Create GitHub App</Button></div>
          </div>
        )}
      </Section>

      <Section title="2. Install on All repositories">
        {!app ? <p className="fx-small fx-muted" style={{ margin: 0 }}>After step 1.</p> : (
          <div className="fx-stack fx-stack--sm">
            <p className="fx-small" style={{ margin: 0 }}>
              {installed ? <>Installed on <strong>{app.installationAccount}</strong> ({app.repositorySelection === 'all' ? 'all repositories' : app.repositorySelection || 'some repositories'}).</> : 'Not installed yet. On GitHub pick All repositories, then Install.'}
            </p>
            {installed && app.repositorySelection !== 'all' && <Note tone="warning">Only selected repositories: new repos won't be reachable. Open the install page and switch to All repositories.</Note>}
            <div className="fx-row fx-row--wrap">
              <Button tone={installed ? 'neutral' : 'primary'} icon="external" disabled={busy || !app.installUrl} onClick={() => window.location.assign(app.installUrl)}>{installed ? 'Change installation' : 'Install'}</Button>
              <Button icon="refresh" disabled={busy} onClick={() => void act('installation')}>Check installation</Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="3. Authorize as Brett">
        {!app ? <p className="fx-small fx-muted" style={{ margin: 0 }}>After step 1.</p> : (
          <div className="fx-stack fx-stack--sm">
            <p className="fx-small" style={{ margin: 0 }}>
              {user?.state === 'none' || !user ? 'Needed to create repos (installation tokens can\'t on a personal account).'
                : user.ok ? <>Authorized as <strong>{String(user.login ?? '')}</strong>. Renews by itself; refresh token good until {time(user.refreshExpiresAt)}.</>
                  : <>Stopped renewing: {user.why ?? 'refresh failed'}. Authorize again.</>}
            </p>
            <div className="fx-row fx-row--wrap">
              <Button tone={user?.ok ? 'neutral' : 'primary'} icon="user" disabled={busy} onClick={() => void authorize()}>{user?.ok ? 'Authorize again' : 'Authorize as Brett'}</Button>
              {user?.ok && <Button icon="x" disabled={busy} onClick={() => { if (window.confirm('Sign the GitHub user token out? Repo creation stops until you authorize again.')) void act('forget', { all: false }); }}>Sign out</Button>}
            </div>
          </div>
        )}
      </Section>

      {s?.configured && (
        <Section title="Health">
          <ul className="fx-stack fx-stack--sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <CheckRow label="App key" c={c.key} ok="GitHub accepts the app's key." />
            <CheckRow label="Installation" c={c.installation} ok={`Installation ${String(c.installation?.id ?? '')}`} />
            <CheckRow label="Installation token" c={c.token} ok={`Good until ${time(c.token?.expiresAt)}; renewed at 50 min.`} />
            <CheckRow label="User token" c={c.user} ok={`Access token until ${time(c.user?.accessExpiresAt)}.`} />
            <CheckRow label="Rate limit" c={c.rateLimit} ok={`${String(c.rateLimit?.remaining ?? '')}/${String(c.rateLimit?.limit ?? '')} left this hour.`} />
            <CheckRow label="Credential files" c={c.files} ok="Folder 700, files 600, on the server only." />
          </ul>
          <div className="fx-row fx-row--wrap">
            <Button icon="refresh" disabled={busy} onClick={() => void act('keep')}>Mint a token now</Button>
            <Button tone="ghost" icon="trash" disabled={busy} onClick={() => { if (window.confirm('Forget the GitHub App on this console? GitHub falls back to the old token. The app stays on GitHub until you delete it there.')) void act('forget', { all: true }); }}>Forget the app here</Button>
          </div>
        </Section>
      )}
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Tokens and keys stay on the console server (folder .axf-console/github-app, owner-only). git, gh, the push banner, CI reads and the activity feed use the app; the old personal token is only the fallback.</p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'GitHub',
  version: '0.1.0',
  appMenu,
  register: (rt) => catchReturn(rt),
  settingsTabs: [{ id: TAB, label: 'GitHub', icon: 'github', order: 15, parent: 'plugins' }],
  settingsPanels: [
    { id: 'github-app.setup', tab: TAB, title: 'GitHub App', icon: 'github', order: 10, render: () => <GitHubAppPanel /> },
    { id: 'github-app.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
