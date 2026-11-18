/**
 * Host services console actions: what voice (AmberX, the wake listener), the action bus, control@1 and plugin-commands
 * run in the open console. Each calls the same /api/host-services route as the page, the CLI and the MCP tools.
 *   host.open[:id]                 open Settings → Plugins → Host services
 *   host.status[:id]               say how the host services are (or one of them)
 *   host.restart:<id>              restart one service's unit (destructive: the console confirms first)
 *   host.rollback:<id>             give one part back to the console's copy (destructive: the console confirms first)
 *   host.mode:<id>:<container|shadow|host>   move one service (moving back confirms)
 */
import type { AxfRuntime } from '@console/axf/core';
import { hostServicesApi, refreshHostServices, since, type HostList } from '@console/hostServices';

const TITLE = 'Host services';
const fail = (rt: AxfRuntime) => (e: Error) => rt.toast(e.message, 'danger', TITLE);

export function statusLine(list: HostList, id = ''): string {
  if (list.down) return `The host API is down${list.downSince ? ` for ${since(list.downSince)}` : ''}: ${list.down.message}`;
  const rows = id ? list.services.filter((s) => s.id === id) : list.services;
  if (id && !rows.length) return `There is no host service called ${id}.`;
  if (id) { const s = rows[0]!; return `${s.manifest?.title || s.id} is ${s.mode === 'container' && s.status === 'down' ? 'running in the console' : s.status}${s.since ? ` for ${since(s.since)}` : ''}, mode ${s.mode}.${s.reason ? ` ${s.reason}.` : ''}`; }
  const bad = rows.filter((s) => s.mode !== 'container' && s.status !== 'up');
  return `${rows.length} host services; ${bad.length ? `${bad.length} not up: ${bad.map((s) => `${s.id} ${s.status}`).join(', ')}` : 'all up or in the console'}.`;
}

export function registerHostActions(rt: AxfRuntime): void {
  rt.actions.register('host.open', () => { rt.dispatch('settings.open:host-services'); }, { label: 'Open Host services', effect: 'navigate' });
  rt.actions.register('host.status', ([id = '']) => {
    void hostServicesApi<HostList>('?fresh=true').then((l) => rt.toast(statusLine(l, id), l.down ? 'danger' : 'info', TITLE), fail(rt));
  }, { label: 'Say how the host services are', params: true, effect: 'read' });
  rt.actions.register('host.restart', ([id = '']) => {
    if (!id) { rt.toast('Say which service, for example host.restart:builds-live.', 'warning', TITLE); return; }
    void hostServicesApi<{ unit: string; state: string }>(`${encodeURIComponent(id)}/unit/restart`, { method: 'POST', body: { confirm: true } })
      .then((r) => { rt.toast(`${r.unit} restarted (${r.state}).`, 'success', TITLE); void refreshHostServices(true); }, fail(rt));
  }, { label: 'Restart a host service', params: true, effect: 'destructive' });
  rt.actions.register('host.rollback', ([id = '']) => {
    if (!id) { rt.toast('Say which service, for example host.rollback:builds-live.', 'warning', TITLE); return; }
    void hostServicesApi<{ ok: boolean; to: string }>(`${encodeURIComponent(id)}/rollback`, { method: 'POST', body: { confirm: true, to: 'container', why: 'voice' } })
      .then((r) => { rt.toast(`${id} is back in the ${r.to}${r.ok ? '' : ' (a step failed: see Host services)'}.`, r.ok ? 'success' : 'warning', TITLE); void refreshHostServices(true); }, fail(rt));
  }, { label: 'Roll a host service back to the console', params: true, effect: 'destructive' });
  rt.actions.register('host.mode', ([id = '', to = '']) => {
    if (!id || !['container', 'shadow', 'host'].includes(to)) { rt.toast('Say a service and a mode, for example host.mode:builds-live:shadow.', 'warning', TITLE); return; }
    void hostServicesApi<{ mode: string }>(`${encodeURIComponent(id)}/mode`, { method: 'PUT', body: { to, confirm: true } })
      .then((r) => { rt.toast(`${id} is now ${r.mode}.`, 'success', TITLE); void refreshHostServices(true); }, fail(rt));
  }, { label: 'Move a host service (container, shadow, host)', params: true, effect: 'write' });
}
