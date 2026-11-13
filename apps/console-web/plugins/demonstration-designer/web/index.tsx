/**
 * Demonstration Designer console plugin (ai.amberx.axf.console.demonstration-designer): pitch the product in three
 * picks and one button. The page (page.tsx) is the main flow, the stage (stage.ts) plays the pitch on the live
 * console, the settings panel (settings.tsx) is a sub-tab of Settings → Plugins, and the actions pitch.* make every
 * move reachable by voice (AmberX), MCP and the CLI through plugin-commands. The deep link `?axf-demo=<id>` opens a
 * saved pitch (`&axf-autoplay=1` plays it).
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import './demonstration-designer.css';
import { parseDeepLink } from '../engine.mjs';
import { appMenu } from './menu';
import { PLUGIN_ID, SETTINGS_TAB, VIEW, generate, getDemo, getModel, loadSettings, want } from './model';
import { DesignerPage } from './page';
import { LifecyclePanel, SettingsPanel } from './settings';
import { next, pause, play, prev, registerStage, resume, stop } from './stage';
import { matchDemo, parsePipelineLink } from '../pipelines.mjs';
import type { Dock } from '../pipelines.mjs';
import { PipelineCover } from './cover';
import { getPipelines, loadPipelines, openDesignerOnPipelines, pChapter, pDock, pMode, pNext, pPause, pPrev, pRestart, pResume, pSpeed, pStop, registerPipelines, runPipeline, setFollow, setKinds, setPanel, setQuery } from './pipeline-model';

/** A demo by id or by the words of a phrase ("voice to app", "the approval flow"). */
async function pipelineId(words: string): Promise<string> {
  await loadPipelines();
  return matchDemo(words, getPipelines().demos);
}

async function playDemo(id: string, record = false) {
  await loadSettings();
  const d = await getDemo(id);
  void play({ id: d.id, title: d.name, steps: d.data.steps, cta: d.pitch?.cta, product: d.pitch?.product, narrator: d.data.voice.narrator, speed: d.data.voice.speed }, { settings: getModel().settings, record });
}

function register(rt: AxfRuntime) {
  registerStage(rt);
  rt.actions.register('pitch.open', ([id]) => { if (id) want(id, false); rt.navigate(VIEW); }, { label: 'Open the Demonstration Designer on a pitch', params: true });
  rt.actions.register('pitch.play', ([id]) => { if (id) playDemo(id).catch((e: Error) => rt.toast(e.message, 'warning', 'Demonstration Designer')); else rt.navigate(VIEW); }, { label: 'Play a pitch demo', params: true });
  rt.actions.register('pitch.export', ([id]) => { if (id) playDemo(id, true).catch((e: Error) => rt.toast(e.message, 'warning', 'Demonstration Designer')); }, { label: 'Export a pitch demo as video (records it while it plays)', params: true });
  rt.actions.register('pitch.generate', ([topic, minutes]) => {
    if (!topic) { rt.navigate(VIEW); return; }
    generate(topic, { minutes: minutes ? Number(minutes) : undefined, save: true }).then((d) => { want(d.id, true); rt.navigate(VIEW); }, (e: Error) => rt.toast(e.message, 'warning', 'Demonstration Designer'));
  }, { label: 'Generate a pitch of a plugin or screen', params: true });
  rt.actions.register('pitch.pause', () => pause(), { label: 'Pitch: pause', searchable: false });
  rt.actions.register('pitch.resume', () => resume(), { label: 'Pitch: resume', searchable: false });
  rt.actions.register('pitch.next', () => next(), { label: 'Pitch: next step', searchable: false });
  rt.actions.register('pitch.prev', () => prev(), { label: 'Pitch: previous step', searchable: false });
  rt.actions.register('pitch.stop', () => void stop(), { label: 'Pitch: stop', searchable: false });
  // Pipelines mode: "run the voice-to-app demo" → pipeline.run:voice to app; every player move is an action too
  registerPipelines(rt);
  const warn = (e: Error) => rt.toast(e.message, 'warning', 'Pipeline demos');
  const runBy = (words: string | undefined, mode?: 'replay' | 'live') => {
    if (!words) { openDesignerOnPipelines(); return; }
    pipelineId(words).then((id) => { if (!id) { rt.toast(`No pipeline demo matches "${words}".`, 'warning', 'Pipeline demos'); return; } openDesignerOnPipelines(id); return runPipeline(id, { mode }); }).catch(warn);
  };
  rt.actions.register('pipeline.open', ([w]) => { if (!w) { openDesignerOnPipelines(); return; } pipelineId(w).then((id) => openDesignerOnPipelines(id), warn); }, { label: 'Open the pipeline demos (optionally on one)', params: true });
  rt.actions.register('pipeline.run', ([w, mode]) => runBy(w, mode === 'live' ? 'live' : mode === 'replay' ? 'replay' : undefined), { label: 'Run a pipeline demo (say its name: voice to app, skin swap, approval flow…)', params: true });
  rt.actions.register('pipeline.live', ([w]) => runBy(w, 'live'), { label: 'Run a pipeline demo live on the test-sandbox project', params: true });
  rt.actions.register('pipeline.replay', ([w]) => runBy(w, 'replay'), { label: 'Replay a pipeline demo (recorded, offline)', params: true });
  rt.actions.register('pipeline.pause', () => pPause(), { label: 'Pipeline demo: pause', searchable: false });
  rt.actions.register('pipeline.resume', () => pResume(), { label: 'Pipeline demo: resume', searchable: false });
  rt.actions.register('pipeline.next', () => pNext(), { label: 'Pipeline demo: skip to the next chapter', searchable: false });
  rt.actions.register('pipeline.prev', () => pPrev(), { label: 'Pipeline demo: previous chapter', searchable: false });
  rt.actions.register('pipeline.chapter', ([n]) => pChapter(Math.max(0, Number(n ?? 1) - 1)), { label: 'Pipeline demo: jump to chapter N', params: true, searchable: false });
  rt.actions.register('pipeline.restart', () => pRestart(), { label: 'Pipeline demo: restart', searchable: false });
  rt.actions.register('pipeline.stop', () => pStop(), { label: 'Pipeline demo: stop', searchable: false });
  rt.actions.register('pipeline.speed', ([v]) => pSpeed(Number(v) || 1), { label: 'Pipeline demo: speed (0.5, 1, 1.5, 2, 4)', params: true, searchable: false });
  rt.actions.register('pipeline.mode', ([v]) => pMode(v === 'live' ? 'live' : 'replay'), { label: 'Pipeline demo: replay or live', params: true, searchable: false });
  rt.actions.register('pipeline.dock', ([v]) => pDock((['dock', 'float', 'full'].includes(v ?? '') ? v : 'dock') as Dock), { label: 'Behind the scenes: dock, float or full', params: true, searchable: false });
  rt.actions.register('pipeline.panel', ([v]) => setPanel(v !== 'off' && v !== 'hide'), { label: 'Behind the scenes: show or hide (on / off)', params: true, searchable: false });
  rt.actions.register('pipeline.filter', ([kinds, ...q]) => { setKinds(kinds && kinds !== 'all' ? kinds.split(',') : []); setQuery(q.join(':')); }, { label: 'Behind the scenes: filter (kinds comma separated, then words)', params: true, searchable: false });
  rt.actions.register('pipeline.follow', ([v]) => setFollow(v !== 'off'), { label: 'Pipeline demo: console follows each chapter (on / off)', params: true, searchable: false });
  // the pipelines deep link: ?axf-pipeline=<id>[&axf-autoplay=1][&axf-mode=live]; ?axf-pipeline=library opens the list
  try {
    const pl = parsePipelineLink(globalThis.location?.search ?? '');
    if (pl) {
      const u = new URL(globalThis.location.href); for (const k of ['axf-pipeline', 'axf-autoplay', 'axf-mode']) u.searchParams.delete(k); globalThis.history?.replaceState(null, '', u.toString());
      const id = pl.id === 'library' ? '' : pl.id;
      for (const ms of [0, 1500]) setTimeout(() => openDesignerOnPipelines(id), ms);
      if (id && pl.play) setTimeout(() => void runPipeline(id, { mode: pl.mode }).catch(warn), 1800);
    }
  } catch { /* no address here */ }
  // the deep link: ?axf-demo=<id>[&axf-autoplay=1]; ?axf-demo=new opens the designer ready for a new pitch; ?axf-demo=settings its settings
  try {
    const link = parseDeepLink(globalThis.location?.search ?? '');
    if (link) {
      const u = new URL(globalThis.location.href); u.searchParams.delete('axf-demo'); u.searchParams.delete('axf-autoplay'); globalThis.history?.replaceState(null, '', u.toString());
      if (link.id === 'settings') {
        // the settings tab exists once this plugin has registered: open it now and again after the shell has settled
        for (const ms of [0, 1200, 3000]) setTimeout(() => rt.dispatch(`settings.open:${SETTINGS_TAB}`), ms);
      } else {
        if (link.id !== 'new') want(link.id, link.play);
        // the shell restores its last page while plugins load (late on a cold start or a slow phone): keep the link's
        // page on top until it has stayed for a few seconds, then leave the person free to move on
        const until = Date.now() + 25000;
        let stable = 0;
        const keep = setInterval(() => {
          if (rt.getState().view === VIEW) { stable += 300; if (stable >= 2500 || Date.now() > until) clearInterval(keep); return; }
          stable = 0;
          if (Date.now() > until) { clearInterval(keep); return; }
          rt.navigate(VIEW);
        }, 300);
        rt.navigate(VIEW);
      }
    }
  } catch { /* no address here */ }
}

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Demonstration Designer',
  version: '0.1.0',
  provides: ['service:demonstrations@1'],
  appMenu,
  register,
  views: { 'demonstration-designer': { title: 'Demonstration Designer', icon: 'play', render: () => <DesignerPage /> } },
  nav: { label: 'Demos', items: [{ id: 'demonstration-designer', label: 'Demonstration Designer', icon: 'play', view: 'demonstration-designer' }] },
  slots: { 'app.frame.cover': [{ id: 'demonstration-designer.pipelines', order: 96, render: () => <PipelineCover /> }] },
  settingsTabs: [{ id: SETTINGS_TAB, label: 'Demonstration Designer', icon: 'play', order: 62, parent: 'plugins' }],
  settingsPanels: [
    { id: 'demonstration-designer.settings', tab: SETTINGS_TAB, title: 'Pitch, stage, music and export', icon: 'play', order: 10, render: () => <SettingsPanel /> },
    { id: 'demonstration-designer.lifecycle', tab: SETTINGS_TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
};
