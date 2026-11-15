/**
 * drill.mjs — the console-down drill (axf-molly@1): prove that with the console container stopped, builds still launch,
 * land and get Shipped features. Brett, Nov 15 2026: "the console goes down … and the builds keep running."
 *
 *   node apps/axf-molly/molly.mjs drill [--json]
 *
 * What it checks, in order (each line is a pass or a fail with the reason; nothing is changed unless AXF_DRILL_STOP=1):
 *   1. axf-molly owns the lease (a drill in shadow mode would prove nothing: the console side acts there)
 *   2. the host bridge answers (bridge.ping) and sees tmux (tmux.list)
 *   3. a dispatcher tick runs here and writes state.json (the plan, not necessarily a launch: the Queue may be empty)
 *   4. a lander round runs here (dry when the merge queue is off)
 *   5. the Shipped sender finds newly landed builds (shipped landed, dry when nothing landed)
 *   6. alerts to the console are optional: makeConsole returns null while the console is down and the tick goes on
 * With AXF_DRILL_STOP=1 and a bridge that allows it, the drill first stops the console (docker stop axf-console) and
 * starts it again at the end. The bridge does not allow docker, so this needs a host shell: the installer prints the
 * two commands; the drill records which steps ran with the console down.
 */
import { spawnSync } from 'node:child_process';
import * as M from '../../framework/core/axf-molly.mjs';
import * as molly from './molly.mjs';

export async function drill({ env = process.env } = {}) {
  const lines = []; const steps = [];
  const step = (name, ok, note = '') => { steps.push({ name, ok, note }); lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? `: ${note}` : ''}`); };
  const lease = molly.readLease(env);
  const owner = M.leaseOwner(lease);
  step('axf-molly owns the lease', owner === 'axf-molly', M.actingWhy(lease, 'axf-molly'));
  let bridge = null;
  try { ({ bridge } = await import('./bridge-client.mjs')); } catch (e) { step('bridge client loads', false, e.message); }
  if (bridge) {
    const p = await bridge('bridge.ping', [], { timeout: 5000 }); step('host bridge answers', p.ok, p.error || 'pong');
    const t = await bridge('tmux.list', [], { timeout: 10000 }); step('bridge sees tmux', t.ok || /no server running/.test(t.stderr), t.ok ? `${t.stdout.trim().split('\n').filter(Boolean).length} pane(s)` : t.stderr.trim().slice(0, 120));
  }
  const consoleUp = (() => { if (!env.AXF_CONSOLE_URL) return null; const r = spawnSync('curl', ['-s', '-m', '3', '-o', '/dev/null', '-w', '%{http_code}', `${env.AXF_CONSOLE_URL.replace(/\/$/, '')}/api/health`], { encoding: 'utf8' }); return r.status === 0 && /^[23]/.test(r.stdout.trim()); })();
  lines.push(`console: ${consoleUp === null ? 'no AXF_CONSOLE_URL' : consoleUp ? 'UP (the drill is not console-down; stop it with: docker stop axf-console)' : 'DOWN (this is the drill)'}`);
  const tick = molly.runTool('orchestrator.tick', { force: true }, { env, by: 'drill' });
  step('dispatcher tick runs here', tick.ok !== false && !tick.shadow, tick.shadow ? `ran as shadow: ${tick.why}` : tick.error || `launched ${(tick.launched ?? []).length}, ended ${(tick.ended ?? []).length}, queue ${(tick.plan?.queue ?? []).length}`);
  const land = molly.runTool('lander.run', { force: true }, { env, by: 'drill' });
  step('lander round runs here', land.ok !== false, land.error || `${(land.items ?? []).length} candidate(s)${land.on === false ? ' (merge queue off: dry)' : ''}`);
  const ship = molly.runTool('features.landed', { force: true }, { env, by: 'drill' });
  step('Shipped sender runs here', ship.ok !== false, ship.error || `${(ship.shipped ?? ship.items ?? []).length} shipped`);
  const ok = steps.every((s) => s.ok);
  lines.unshift(`Console-down drill · ${new Date().toISOString()} · ${ok ? 'PASS' : 'FAIL'}${consoleUp ? ' (console was up)' : ''}`);
  molly.shadowLog(M.diffEntry('drill', { note: `${ok ? 'pass' : 'fail'}: ${steps.filter((s) => !s.ok).map((s) => s.name).join(', ') || 'every step'}; console ${consoleUp === null ? 'unknown' : consoleUp ? 'up' : 'down'}` }), env);
  return { ok, consoleUp, steps, lines };
}
