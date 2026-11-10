/**
 * The apps Molly holds. Each one stays its own app at its own address and runs the same on its own; inside Molly it
 * mounts natively (shell-surface@1, molly/native.tsx): Molly imports the app's surface module and shows its screens in
 * Molly's own page, under Molly's one banner, menu, nav and settings. No frames (Brett, Nov 8 2026). Add an app here
 * and in the nav-menu / app-menu / toolbar assets.
 */
export interface MollyApp {
  /** View id in Molly (also the first part of a deep link: #/<id>/<route>). */
  id: string;
  label: string;
  icon: string;
  /** The app's own address. */
  url: string;
  description: string;
  /** Its native surface module (shell-surface@1 `mount.module`): an ES module exporting `mountSurface`. Absent = the
   *  app has no native surface yet (it is listed and opens on its own). */
  surface?: string;
  /** How its screens sign in (shell-surface@1 `mount.auth`). */
  auth?: 'none' | 'console-token' | 'hub-session' | 'app-session';
}

export const MOLLY_APPS: MollyApp[] = [
  { id: 'amberx', label: 'AmberX', icon: 'sparkles', url: 'https://amberx.amberxai.com', description: 'The AmberX app: plugins, voice, walkthroughs.', surface: 'https://amberx.amberxai.com/surface/amberx-surface.js', auth: 'hub-session' },
  { id: 'axhub', label: 'axHub', icon: 'shield', url: 'https://axhub.amberxai.com', description: 'The connector hub: approvals, go pass, services.', surface: 'https://axhub.amberxai.com/surface/axhub-surface.js', auth: 'hub-session' },
  { id: 'console', label: 'Console', icon: 'terminal', url: 'https://console.amberxai.com', description: 'The AXF Dev Console: builds, plugins, UI Review.', surface: 'https://console.amberxai.com/surface/console-surface.js', auth: 'console-token' },
  { id: 'expenses', label: 'Expenses', icon: 'chart', url: 'https://expenses.amberxai.com', description: 'The Expense Tracker: ledger, paydays, reports, assistant.' },
];

export const mollyApp = (id: string | undefined | null): MollyApp | undefined => MOLLY_APPS.find((a) => a.id === id);

/** `#/<app>/<screen…>` → the app (main.tsx opens its screen once the app has loaded), and its own address. */
export function deepLink(hash: string): { app: MollyApp; src: string } | null {
  const parts = hash.replace(/^#\/?/, '').split('/');
  const app = mollyApp(parts[0]);
  if (!app) return null;
  const route = parts.slice(1).join('/');
  return { app, src: route ? `${app.url}/#/${route}` : app.url };
}
