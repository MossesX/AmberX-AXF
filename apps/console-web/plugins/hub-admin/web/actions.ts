/**
 * The Hub plugin's registered actions: the one deep-link vocabulary every transport shares (menus, search, toolbars,
 * AmberX voice, control@1's console domain, console_open / console_show with a focus).
 *
 *   hub.open[:<screen>[:<row>]]   open the Hub on a screen (and bring a row forward)          navigate
 *   hub.focus:<screen>[/<row>]    what `console_open hub --focus <screen>/<row>` runs (the screen's focus action)
 *   hub.<screen>, hub.<alias>     one per screen of the route table and per alias ("open hub approvals", hub.approvalLog)   navigate
 *   hub.approvals.approve:<id>, hub.approvals.deny:<id>, hub.approvals.shelve:<id>
 *                                 Brett's own tap only (personOnly): the console catalog never lists them and a remote
 *                                 caller is refused; they exist so menus and buttons share one deciding path.
 */
import type { AxfRuntime } from '@console/axf/core';
import { screenOf, screensOf, type HubConsoleTable } from '@console/axf/core/hub-console.mjs';
import { decideApproval } from '@console/axf/libs/approvals/react';
import { vetoHost } from '@console/axf/libs/hub/veto';
import { VIEW } from './ids';
import { requestFocus, setActiveScreen } from './store';
import { itemOf, readApproval } from './approvals';

const ROW_SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function registerHubActions(rt: AxfRuntime, table: HubConsoleTable): void {
  const on = rt.actions.register.bind(rt.actions);
  const home = table.home ?? screensOf(table)[0]?.id ?? 'approvals';
  const open = (screen: string, row?: string, action?: string) => {
    const s = screenOf(table, screen) ? screen : home;
    if (row && ROW_SAFE.test(row)) requestFocus(s, row, action); else setActiveScreen(s);
    if (rt.getState().view !== VIEW) rt.navigate(VIEW);
  };
  on('hub.open', ([screen = '', row = '']) => open(screen || home, row || undefined), { label: 'Open the Hub (a screen, a row)', params: true, effect: 'navigate' });
  on('hub.focus', ([enc = '']) => { const [screen = '', row = '', action = ''] = decodeURIComponent(enc).split('/'); open(screen || home, row || undefined, action || undefined); }, { label: 'Open a hub screen, down to one row', params: true, effect: 'navigate' });
  const camel = (w: string) => w.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  for (const s of screensOf(table)) {
    on(`hub.${s.id}`, () => open(s.id), { label: `Open Hub → ${s.title}`, effect: 'navigate' });
    // the screen's other words (table `aliases`): `hub.approvalLog` for the log
    for (const alias of s.aliases ?? []) on(`hub.${camel(alias)}`, () => open(s.id), { label: `Open Hub → ${s.title}`, effect: 'navigate', searchable: false });
  }

  // Deciding (person only): the same path the row buttons take, through the approvals-banner relay.
  const decide = async (id: string, d: 'approve' | 'deny') => {
    if (!ROW_SAFE.test(id)) return;
    const r = await readApproval(id);
    if (!r.ok) { rt.toast(r.message, 'danger', 'Hub'); return; }
    const lib = itemOf(r.hub, r.item);
    if (!lib) { rt.toast('Not a request this hub knows.', 'danger', 'Hub'); return; }
    const res = await decideApproval(r.hub, lib, lib.kind === 'held' ? (d === 'approve' ? 'approve' : 'deny') : (d === 'approve' ? 'approve' : 'decline'));
    rt.toast(res.ok ? (res.message || `${d === 'approve' ? 'Approved' : 'Denied'}: ${lib.title}`) : res.message || 'Nothing was decided.', res.ok ? 'success' : 'danger', 'Hub');
  };
  on('hub.approvals.approve', ([id = '']) => { void decide(id, 'approve'); }, { label: 'Approve a hub request', params: true, effect: 'write', personOnly: true });
  on('hub.approvals.deny', ([id = '']) => { void decide(id, 'deny'); }, { label: 'Deny a hub request', params: true, effect: 'write', personOnly: true });
  on('hub.approvals.shelve', ([id = '']) => {
    const act = vetoHost().act;
    if (!ROW_SAFE.test(id)) return;
    if (!act) { rt.toast('Shelve needs the approvals-banner relay (the plugin is off).', 'warning', 'Hub'); return; }
    void act(id, 'shelve').then((r) => rt.toast(r.ok ? 'Shelved: the countdown is paused until you decide.' : r.error || 'Nothing was shelved.', r.ok ? 'info' : 'danger', 'Hub'));
  }, { label: 'Shelve a held call', params: true, effect: 'write', personOnly: true });
}
