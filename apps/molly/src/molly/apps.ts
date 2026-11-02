/**
 * The apps Molly shows. Each one stays its own app at its own address and runs exactly as it does on its own: Molly
 * only frames that address (plain URL, no embed marker, nothing hidden, taken over or merged). Add an app here and in
 * the nav-menu / app-menu / toolbar assets.
 */
export interface MollyApp {
  /** View id in Molly (also the first part of a deep link: #/<id>/<route>). */
  id: string;
  label: string;
  icon: string;
  /** The app's own address. */
  url: string;
  description: string;
}

export const MOLLY_APPS: MollyApp[] = [
  { id: 'amberx', label: 'AmberX', icon: 'sparkles', url: 'https://amberx.amberxai.com', description: 'The AmberX app: plugins, voice, walkthroughs.' },
  { id: 'axhub', label: 'axHub', icon: 'shield', url: 'https://axhub.amberxai.com', description: 'The connector hub: approvals, go pass, services.' },
  { id: 'console', label: 'Console', icon: 'terminal', url: 'https://console.amberxai.com', description: 'The AXF Dev Console: builds, plugins, UI Review.' },
];

export const mollyApp = (id: string | undefined | null): MollyApp | undefined => MOLLY_APPS.find((a) => a.id === id);

/** `#/<app>/<route…>` → the app and the address its frame starts on. */
export function deepLink(hash: string): { app: MollyApp; src: string } | null {
  const parts = hash.replace(/^#\/?/, '').split('/');
  const app = mollyApp(parts[0]);
  if (!app) return null;
  const route = parts.slice(1).join('/');
  return { app, src: route ? `${app.url}/#/${route}` : app.url };
}
