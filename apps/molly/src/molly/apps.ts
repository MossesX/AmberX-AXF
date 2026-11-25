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

/** A veto pass id (control-pass@1: `pass-<base36 ms>-<6 hex>`; the same pattern as pass-approval@1's `PASS_ID_RE`). */
const PASS_ID_RE = /^pass-[0-9a-z]{1,16}-[0-9a-f]{6}$/;
const PASS_DECISIONS = ['approve', 'deny'];

/**
 * A veto pass named any of the ways a link or a command names it (pass-approval@1): the target `pass:<id>`, a bare id,
 * or the route `pass/<id>`, each with an optional `/approve` or `/deny`. Null when it names no pass.
 */
export function parsePass(text: string): { id: string; decision?: string } | null {
  const parts = text.trim().replace(/^pass[:/]/i, '').split('/');
  const id = parts[0] ?? '';
  if (!PASS_ID_RE.test(id) || parts.length > 2) return null;
  if (parts.length === 2 && !PASS_DECISIONS.includes(parts[1]!)) return null;
  return { id, ...(parts[1] ? { decision: parts[1] } : {}) };
}

/** The Molly address of a veto pass: `#/console/pass/<id>[/approve|/deny]`, or '' when `text` names no pass. */
export function passHash(text: string): string {
  const pass = parsePass(text);
  return pass ? `#/console/pass/${pass.id}${pass.decision ? `/${pass.decision}` : ''}` : '';
}

/**
 * `#/<app>/<route…>` → the app, its route and the address its frame opens. A veto pass (pass-approval@1) is a console
 * route: `#/console/pass/<id>[/approve|/deny]`, with `#/pass/<id>…` and `#/pass:<id>…` as short forms; the console
 * opens its pass-approval view on it, and Approve / Deny there go to the shared pass routes with Brett's own session.
 */
export function deepLink(hash: string): { app: MollyApp; route: string; src: string } | null {
  const path = hash.replace(/^#\/?/, '').split('?')[0]!;
  // `pass:<id>` may arrive percent-encoded (`pass%3A<id>`); every other route is passed on exactly as written
  let named = path;
  try { named = decodeURIComponent(path); } catch { /* not percent-encoded */ }
  const short = /^pass[:/]/i.test(named) ? passHash(named) : '';
  const parts = (short ? short.slice(2) : path).split('/').filter(Boolean);
  const app = mollyApp(parts[0]);
  if (!app) return null;
  const route = parts.slice(1).join('/');
  return { app, route, src: route ? `${app.url}/#/${route}` : app.url };
}
