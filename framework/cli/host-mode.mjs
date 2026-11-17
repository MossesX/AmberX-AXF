/**
 * host-mode — where a moved console part runs today (host-service-mode@1, framework/spec/HOST-SERVICES.md → Migration).
 * The console's copy of a loop calls `containerRuns(id)` at the top of every pass and skips when the service is in
 * `host` mode; the host runner (axf-hostd.mjs, AXF_HOST_SIDE=1) always runs. Python twin:
 * apps/console-web/server/host_mode.py.
 *
 *   import { containerRuns, hostMode } from './host-mode.mjs';
 *   if (!containerRuns('builds-live')) return;   // the host publishes
 *
 * The mode file is <shared data>/host-services/mode.json (persist.mjs → persistRoot(), else the repo's _data);
 * AXF_HOST_MODE_FILE overrides it. A missing or unreadable file is `container` (nothing has moved).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { persistRoot, REPO_ROOT } from './persist.mjs';

export const modeFile = () => process.env.AXF_HOST_MODE_FILE || join(persistRoot() ?? join(REPO_ROOT, '_data'), 'host-services/mode.json');
/** True in a host runner (axf-hostd sets it), never in the console container. */
export const onHost = () => process.env.AXF_HOST_SIDE === '1';
/** container | shadow | host for one service id. */
export function hostMode(id) {
  try {
    const doc = JSON.parse(readFileSync(modeFile(), 'utf8'));
    const m = doc?.services?.[id]?.mode;
    return m === 'shadow' || m === 'host' ? m : 'container';
  } catch { return 'container'; }
}
/** Should the console's copy of `id` do its work now? Always on the host side; in the container unless the mode is host. */
export const containerRuns = (id) => onHost() || hostMode(id) !== 'host';
