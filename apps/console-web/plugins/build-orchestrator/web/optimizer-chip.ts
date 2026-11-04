import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';

/*
 * The optimizer's banner chip (addendum 4): after a run the Optimizer notifications setting says to tell Brett about
 * (Basic because AI wasn't available, or every run), a framework status widget on the banner says which mode ran and
 * the result; a tap opens Optimize builds, which marks it seen. The bell alert and the phone come from the server.
 */
const ASSET_ID = 'build-optimizer';
const COUNTER = 'build.optimizer.notice';
const ORIGIN = 'ai.amberx.axf.console.build-orchestrator';
const SEEN = 'axp-build-optimizer:seen';
const api = pluginApi('build-orchestrator', 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
type Last = { at: string; mode: string; fellBack: boolean; line: string; scheduled?: boolean };

export async function paintOptimizerChip(rt: AxfRuntime) {
  let last: Last | null = null; let notify = 'no-ai';
  try { const r = await api.call<{ config: { last: Last | null; settings: { notify: string } } }>('optimize/state'); last = r.config?.last ?? null; notify = r.config?.settings?.notify ?? 'no-ai'; } catch { return; }
  let seen = ''; try { seen = localStorage.getItem(SEEN) ?? ''; } catch { /* private window */ }
  const show = !!last && notify !== 'off' && (notify === 'every' || last.fellBack) && last.at > seen;
  const text = last ? `Optimizer: ${last.mode === 'deep' ? 'Deep' : last.fellBack ? 'Basic (no AI)' : 'Basic'}` : 'Optimizer';
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Build optimizer', version: '0.1.0', author: 'Build orchestrator plugin',
    description: `The last Optimize builds run: ${last?.line ?? ''}. Tap to open it.`, tags: ['builds', 'status'],
    data: { counter: COUNTER, onLabel: text, offLabel: text, onTone: last?.fellBack ? 'warning' : 'accent', offTone: 'muted', dot: true, link: 'build-orchestrator.optimize' },
  } as never, 'app', ORIGIN);
  rt.setBadge(COUNTER, show ? 1 : 0);
  if (show) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'right', order: 23, origin: ORIGIN });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}
