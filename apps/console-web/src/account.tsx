/**
 * Who is using the console, from axHub's sign-in wall (server: GET /api/me, server/wall.py).
 *
 * With the wall on, every browser is a signed-in hub account. Its role binds the runtime (`rt.bindPrincipal`) to the
 * console's `console-access` policy: admins have everything; a user changes themes, colours, layouts or style only
 * with the hub permission `console.themes`, and uses a plugin only with `console.plugin.<folder>` (both off until an
 * admin ticks them on the hub's users page). The server enforces the same rules (default-deny for users), so this
 * is the UI side of it. Without the wall (local dev, console token) nothing is bound and the console works as before.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, useRuntime } from './axf/react';
import type { AxfWebLibrary } from './axf/react/library';
import { bundledPlugins } from './plugins';

export interface Me {
  wall: boolean;
  hub: string;
  user: { name: string; role: 'admin' | 'user'; perms: string[]; via: string } | null;
  admin: boolean;
  role: 'admin' | 'themes' | 'user' | null;
  themes: boolean;
  /** plugins an admin may grant to a user (plugin.json "userGrantable": true) */
  grantable?: string[];
  /** plugins open to every signed-in user (plugin.json "wallUsers": true) */
  open?: string[];
  plugins: string[];
}

/** The console's own copy of the framework starter `uac-policy/hub-accounts` (same roles admin / themes / user and the
 *  same permission set); kept separate so the console's descriptions and its hub permission `console.themes` stay as they are. */
export const POLICY = 'console-access';
export const THEMES_PERM = 'console.themes';
export const pluginPerm = (folder: string) => `console.plugin.${folder}`;

let current: Me | null = null;
const listeners = new Set<(m: Me | null) => void>();

/** Ask the server who this browser is and bind the runtime to that account (once per load). */
export async function loadAccount(): Promise<Me | null> {
  try {
    const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    current = (await r.json()) as Me;
  } catch {
    current = null;
  }
  for (const l of listeners) l(current);
  return current;
}

/** The account this console is bound to, or null (no wall). */
export function useAccount(): Me | null {
  const [me, setMe] = useState<Me | null>(current);
  useEffect(() => {
    listeners.add(setMe);
    return () => { listeners.delete(setMe); };
  }, []);
  return me;
}

/** Bind (or unbind) the runtime to the signed-in account whenever it is known. */
export function useBindAccount(): Me | null {
  const rt = useRuntime();
  const me = useAccount();
  useEffect(() => { if (!current) void loadAccount(); }, []);
  useEffect(() => {
    if (me?.wall && me.user && me.role) rt.bindPrincipal({ id: me.user.name, label: me.user.name, policy: POLICY, role: me.role, attributes: { via: me.user.via } });
    else rt.unbindPrincipal();
  }, [rt, me]);
  return me;
}

const link = (hub: string, path: string) => `${hub}${path}`;

/** Settings → Account & security → Your account. */
function AccountPanel() {
  const me = useAccount();
  if (!me) return <p className="fx-muted" style={{ margin: 0 }}>Checking who you are…</p>;
  if (!me.wall || !me.user) {
    return (
      <div className="fx-stack">
        <p style={{ margin: 0 }}>The sign-in wall is off here, so the console works with the console token only (no accounts).</p>
        <p className="fx-muted" style={{ margin: 0 }}>Accounts live on axHub. The console's installer turns the wall on by itself once the hub can sign someone in.</p>
      </div>
    );
  }
  const granted = me.plugins.filter((f) => bundledPlugins.some((p) => p.folder === f));
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <strong>{me.user.name}</strong>
        <Chip tone={me.admin ? 'accent' : undefined}>{me.admin ? 'admin' : 'user'}</Chip>
        {!me.admin && <Chip tone={me.themes ? 'success' : undefined}>{me.themes ? 'themes allowed' : 'themes locked'}</Chip>}
      </div>
      {!me.admin && (
        <p className="fx-muted" style={{ margin: 0 }}>
          Plugins you can use: {granted.length ? granted.join(', ') : 'none yet'}. Ask an admin for more.
        </p>
      )}
      <div className="fx-row fx-row--wrap">
        <a className="fx-btn fx-btn--neutral" style={{ textDecoration: 'none' }} href={link(me.hub, '/auth/account')} target="_blank" rel="noopener noreferrer">Your account (password, name, email)</a>
        <a className="fx-btn fx-btn--neutral" style={{ textDecoration: 'none' }} href={link(me.hub, '/auth/logout')}>Sign out</a>
      </div>
    </div>
  );
}

/**
 * The permission names an admin can tick for a user on the hub's users page, with what each one opens. Only plugins
 * that say they are safe for users ("userGrantable": true) can be granted; the rest stay admin-only (server-enforced).
 */
export function grantablePermissions(grantable: string[]): { id: string; label: string }[] {
  return [
    { id: THEMES_PERM, label: 'Change themes, colours, layouts and style' },
    ...bundledPlugins.filter((p) => grantable.includes(p.folder)).map((p) => ({ id: pluginPerm(p.folder), label: `Plugin: ${p.manifest.name}` })),
  ];
}

/** Settings → Account & security → Account management (admins). Accounts and grants live on the hub's users page. */
function ManagementPanel() {
  const rt = useRuntime();
  const me = useAccount();
  if (!me?.admin) return <p className="fx-muted" style={{ margin: 0 }}>Only admins manage accounts.</p>;
  const perms = grantablePermissions(me.grantable ?? []);
  const adminOnly = bundledPlugins.filter((p) => !(me.grantable ?? []).includes(p.folder) && !(me.open ?? []).includes(p.folder));
  const hints = perms.map((p) => `${p.id}=${p.label.replace(/[,=]/g, ' ')}`).join(',');
  const copy = (text: string, what: string) =>
    navigator.clipboard?.writeText(text).then(() => rt.toast(`${what} copied`, 'success'), () => rt.toast('Select it and copy it by hand', 'warning'));
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>
        Add users, reset passwords, change roles and grant access on the hub. New users and reset passwords are temporary:
        they pick their own at their next sign-in. Every grant below starts off.
      </p>
      {me.wall && <div><a className="fx-btn fx-btn--neutral" style={{ textDecoration: 'none' }} href={link(me.hub, '/auth/admin/users')} target="_blank" rel="noopener noreferrer">Open account management</a></div>}
      <ul className="cx-list">
        {perms.map((p) => (
          <li key={p.id} className="cx-item">
            <div className="fx-grow" style={{ minWidth: 0 }}>
              <span>{p.label}</span>
              <div className="fx-mono fx-small" style={{ overflowWrap: 'anywhere' }}>{p.id}</div>
            </div>
            <Button tone="ghost" icon="copy" onClick={() => copy(p.id, 'Permission')} aria-label={`Copy ${p.id}`} />
          </li>
        ))}
      </ul>
      <p className="fx-muted" style={{ margin: 0 }}>
        To show these as ready-made switches on the hub's users page, set <code>AXHUB_PERMISSION_HINTS</code> in Coolify
        (axHub app → Environment) to this value and redeploy the hub. Otherwise type them into "Others".
      </p>
      <div><Button icon="copy" onClick={() => copy(hints, 'AXHUB_PERMISSION_HINTS value')}>Copy AXHUB_PERMISSION_HINTS value</Button></div>
      <p className="fx-muted" style={{ margin: 0 }}>
        Admins only, whatever is granted (they can reach secrets, containers, files or the host):{' '}
        {adminOnly.map((p) => p.manifest.name).join(', ') || 'none'}. Plugins open to every signed-in user check each user themselves.
      </p>
    </div>
  );
}

/** The console's account settings (built in, not a plugin). */
export const accountLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.accounts',
  label: 'Accounts',
  version: '1.0.0',
  settingsPanels: [
    { id: 'console.account.me', tab: 'account', title: 'Your account', icon: 'user', order: 1, render: () => <AccountPanel /> },
    { id: 'console.account.manage', tab: 'account', title: 'Account management', icon: 'shield', order: 2, render: () => <ManagementPanel /> },
  ],
};
