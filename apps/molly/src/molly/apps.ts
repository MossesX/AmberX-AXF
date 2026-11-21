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
  { id: 'expenses', label: 'Expenses', icon: 'chart', url: 'https://expenses.amberxai.com', description: 'The Expense Tracker: ledger, paydays, reports, assistant.' },
];

export const mollyApp = (id: string | undefined | null): MollyApp | undefined => MOLLY_APPS.find((a) => a.id === id);

/** A veto pass id (control-pass@1: `pass-<base36 ms>-<6 hex>`). */
const PASS_ID_RE = /^pass-[0-9a-z]{1,16}-[0-9a-f]{6}$/;

/**
 * `#/<app>/<route…>` → the app, its route and the address its frame starts on. `#/pass/<id>[/approve|/deny]` is short
 * for `#/console/pass/<id>…` (pass-approval@1: the console opens that pass with Approve / Deny).
 */
export function deepLink(hash: string): { app: MollyApp; src: string; route: string } | null {
  let parts = hash.replace(/^#\/?/, '').split('?')[0]!.split('/').filter(Boolean);
  if (parts[0] === 'pass' && PASS_ID_RE.test(parts[1] ?? '')) parts = ['console', ...parts];
  const app = mollyApp(parts[0]);
  if (!app) return null;
  const route = parts.slice(1).join('/');
  return { app, route, src: route ? `${app.url}/#/${route}` : app.url };
}

/** The Molly hash for a veto pass: `#/console/pass/<id>[/approve|/deny]`, or '' when `id` is no pass id. */
export function passHash(id: string, decision = ''): string {
  const pid = id.replace(/^pass:/i, '').trim();
  if (!PASS_ID_RE.test(pid)) return '';
  return `#/console/pass/${pid}${decision === 'approve' || decision === 'deny' ? `/${decision}` : ''}`;
}
