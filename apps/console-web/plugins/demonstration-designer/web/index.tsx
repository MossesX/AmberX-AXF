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
  settingsTabs: [{ id: SETTINGS_TAB, label: 'Demonstration Designer', icon: 'play', order: 62, parent: 'plugins' }],
  settingsPanels: [
    { id: 'demonstration-designer.settings', tab: SETTINGS_TAB, title: 'Pitch, stage, music and export', icon: 'play', order: 10, render: () => <SettingsPanel /> },
    { id: 'demonstration-designer.lifecycle', tab: SETTINGS_TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
};
