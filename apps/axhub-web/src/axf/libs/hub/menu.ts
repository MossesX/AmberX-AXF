/**
 * lib-hub (web) — the hub in an app's **application menu** (harvested Oct 23 2026, Opus, from the AXHub web app).
 *
 *   const off = installHubMenu(rt, { hub: 'https://axhub.amberxai.com' });
 *
 * Registers two live lists an app-menu asset can name (`provider`), filled when the submenu opens:
 *  - `hub.approvals`: the calls waiting for approval (tool + what it runs), each opening that request on the hub;
 *  - `hub.apps`: the hub's app catalog, each downloading the latest build from the hub;
 * and the actions they run: `hub.review:<approval id>`, `hub.download:<project>:<file>`, `hub.open:<page>`.
 * Every link is rebuilt from the hub address (approval ids and file names must have the hub's own shapes) and checked
 * with `isHub`; nothing from a reply is ever opened as given. Read-only: apps that decide from the menu replace
 * `hub.approvals` with lib-approvals' `installApprovalsMenu` (Deny / Approve on every row, Nov 1 2026).
 */
import type { AxfRuntime, MenuItem } from '../../core';
import { accountUrl, approvalUrl, approvalsUrl, appsUrl, fetchHubFeed, isHub, loginUrl, normalizeHub, HUB_DEFAULT } from './hub';
import { appDownloadUrl, fetchHubApps } from './apps';

export const HUB_MENU_MODULE = 'ai.amberx.axf.hub';
/** Hub pages `hub.open:<page>` can open. */
export const HUB_MENU_PAGES: Record<string, (base: string) => string> = {
  approvals: approvalsUrl,
  apps: appsUrl,
  account: accountUrl,
  'sign-in': (base) => loginUrl(base),
  users: (base) => `${base}/auth/admin/users`,
  home: (base) => base,
};

export interface HubMenuOptions {
  hub?: string;
  /** Action the More… entry of the approvals list runs (default `hub.open:approvals`). */
  approvalsMore?: string;
  /** Action the More… entry of the apps list runs (default `hub.open:apps`). */
  appsMore?: string;
  /** Opens a URL (default: a new tab, no opener). Tests pass their own. */
  open?: (url: string) => void;
}

const row = (id: string, label: string, icon: string, action?: string, extra: Partial<MenuItem> = {}): MenuItem =>
  ({ id, label, icon, ...(action ? { action } : {}), ...extra }) as MenuItem;

/** Registers the hub's live lists and actions on `rt`; returns a function that takes them all off again. */
export function installHubMenu(rt: AxfRuntime, opts: HubMenuOptions = {}): () => void {
  const hub = normalizeHub(opts.hub) ?? HUB_DEFAULT;
  const open = opts.open ?? ((url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); });
  const safeOpen = (url: string | null) => { if (url && isHub(hub, url)) open(url); };
  const offs: (() => void)[] = [];

  offs.push(rt.actions.register('hub.review', (args) => safeOpen(approvalUrl(hub, args[0])), { label: 'Review on the hub', params: true }));
  offs.push(rt.actions.register('hub.download', (args) => safeOpen(appDownloadUrl(hub, args[0] ?? '', args[1] ?? '')), { label: 'Download from the hub', params: true }));
  offs.push(rt.actions.register('hub.open', (args) => { const page = HUB_MENU_PAGES[args[0] ?? 'home']; if (page) safeOpen(page(hub)); }, { label: 'Open on the hub', params: true }));

  offs.push(rt.registerAppMenuProvider('hub.approvals', {
    module: HUB_MENU_MODULE, max: 12, moreAction: opts.approvalsMore ?? 'hub.open:approvals', moreLabel: 'All approvals…',
    items: async () => {
      const f = await fetchHubFeed(hub);
      if (f.status === 'signed-out') return [row('hub-sign-in', 'Sign in to axHub to see them', 'shield', 'hub.open:sign-in')];
      if (f.status === 'not-admin') return [row('hub-not-admin', 'Only hub admins see approvals', 'shield')];
      if (f.status !== 'ok') return [row('hub-unreachable', f.error || "Can't reach the hub", 'alert')];
      if (!f.pending.length) return [row('hub-none', 'Nothing waiting', 'check')];
      return f.pending.map((a) => row(`hub-approval-${a.id}`, a.tool, 'shield', `hub.review:${a.id}`));
    },
  }));

  offs.push(rt.registerAppMenuProvider('hub.apps', {
    module: HUB_MENU_MODULE, max: 12, moreAction: opts.appsMore ?? 'hub.open:apps', moreLabel: 'All apps…',
    items: async () => {
      const f = await fetchHubApps(hub);
      if (f.status === 'signed-out') return [row('hub-sign-in', 'Sign in to axHub to see them', 'shield', 'hub.open:sign-in')];
      if (f.status === 'not-admin') return [row('hub-not-allowed', 'This account may not download apps', 'shield')];
      if (f.status !== 'ok') return [row('hub-unreachable', f.error || "Can't reach the hub", 'alert')];
      if (!f.apps.length) return [row('hub-none', 'No apps yet', 'download')];
      return f.apps.map((a) => row(`hub-app-${a.project}`, `${a.name} ${a.latest.version}`, 'download', `hub.download:${a.project}:${a.latest.file}`));
    },
  }));

  return () => { for (const off of offs.splice(0)) off(); };
}
