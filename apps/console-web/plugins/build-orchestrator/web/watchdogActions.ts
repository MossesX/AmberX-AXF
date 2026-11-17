/**
 * Voice and console actions for the stale-row watchdog (AmberX voice, Ctrl+K, the action bus, console_control). Each
 * calls the same REST route as the Watchdog card, MCP (watchdog-* commands) and `axf watchdog`.
 *   orchestrator.watchdog.open[:settings|runs|log]   open Settings → Plugins → Build orchestrator → Watchdog
 *   orchestrator.watchdog.status                     say when it last ran and what it cleaned
 *   orchestrator.watchdog.run                        run it now (changes the lists: the console confirms first)
 *   orchestrator.watchdog.dry-run                    say what it would clean, changing nothing
 *   orchestrator.watchdog.set:<key>:<value>          change a setting (enabled, intervalMin, dryRun, tables.<id>, notify)
 *   orchestrator.watchdog.log                        open the Cleanups log
 */
import type { AxfRuntime } from '@console/axf/core';
import { dryRun, isWatchdogTab, loadStatus, runLine, runNow, saveSettings, showWatchdogTab, type WatchdogSettings } from './watchdogApi';

const T = 'Stale-row watchdog';

export function registerWatchdogActions(rt: AxfRuntime): void {
  const fail = (e: Error) => rt.toast(e.message, 'danger', T);
  const open = (tab = '') => { rt.dispatch('settings.open:build-orchestrator'); showWatchdogTab(isWatchdogTab(tab) ? tab : 'settings'); };
  rt.actions.register('orchestrator.watchdog.open', ([tab = '']) => open(decodeURIComponent(tab)), { label: 'Open the stale-row watchdog (settings, last runs, cleanups log)', params: true, effect: 'navigate' });
  rt.actions.register('orchestrator.watchdog.log', () => open('log'), { label: 'Open the watchdog Cleanups log', effect: 'navigate' });
  rt.actions.register('orchestrator.watchdog.status', () => {
    void loadStatus(0).then((s) => rt.toast(`${s.settings.enabled ? `On, every ${s.settings.intervalMin} min` : 'Off'}${s.settings.dryRun ? ' (dry run only)' : ''}. ${s.last ? `${new Date(s.last.at).toLocaleString()}: ${runLine(s.last)}` : 'It has not run yet.'}`, 'info', T), fail);
  }, { label: 'When did the watchdog last run and what did it clean', effect: 'read' });
  rt.actions.register('orchestrator.watchdog.run', () => {
    rt.toast('Watchdog running…', 'info', T);
    void runNow().then((r) => rt.toast(runLine(r), r.ok ? 'success' : 'danger', T), fail);
  }, { label: 'Run the stale-row watchdog now', effect: 'destructive' });
  rt.actions.register('orchestrator.watchdog.dry-run', () => {
    void dryRun().then((r) => { rt.toast(runLine(r), 'info', T); open('runs'); }, fail);
  }, { label: 'What would the watchdog clean (dry run)', effect: 'read' });
  rt.actions.register('orchestrator.watchdog.set', ([key = '', value = '']) => {
    const k = decodeURIComponent(key) as keyof WatchdogSettings; const v = decodeURIComponent(value);
    if (!k || !v) { rt.toast('Say a setting and a value, for example orchestrator.watchdog.set:intervalMin:10.', 'warning', T); return; }
    const val = k === 'intervalMin' ? Number(v) : ['on', 'true', 'yes', '1'].includes(v.toLowerCase());
    void saveSettings({ [k]: val }).then((r) => rt.toast(`${k} is ${String(r.settings[k])}.`, 'success', T), fail);
  }, { label: 'Change a watchdog setting', params: true, effect: 'write' });
}
