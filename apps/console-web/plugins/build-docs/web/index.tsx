/**
 * Build docs and walkthroughs console plugin (ai.amberx.axf.console.build-docs).
 *
 * Right-click any build or step that's built — wherever builds show (Build manager rows and its Built history, the
 * Build orchestrator's cards and steps, Pending builds, Plan Studio plans, Codebase changes rows) — and pick
 * **Create documentation** or **Create walkthrough video**. Both dialogs take more builds or single steps
 * (multi-select), so one job can cover several.
 *
 *   docs   Markdown written from the build (Brett's words, steps, report, diff, screens, commands): AI in deep mode,
 *          a template otherwise; a pull request through the merge queue into the plugin's or app's docs/ folder, and a
 *          Docs link in the build's plan.
 *   video  length, focus notes + feature picks, viewport, theme, layout, narration (voice), captions, speed, intro /
 *          outro; the click-path script is shown for approval first, then a real headless browser session is recorded
 *          on the VPS (one veto call, a heavy slot) and the MP4 attaches to the build's plan.
 *
 * Page: Builds → Docs & videos (every job, progress, cancel, re-run with tweaks). Settings → Plugins → Build docs.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { documentable, findBuild, getState, loadIndex, loadJobs, setFocus, FOLDER, ID, type Target } from './store';
import { DocsDialog, JobsPage, ScriptDialog, SettingsSummary, VideoDialog } from './ui';
import { appMenu } from './menu';
import './build-docs.css';

/** Build-ish context targets → the build (and step) they stand for, or null when it isn't built yet. */
export function resolveTarget(target: string | undefined, payload: string | undefined): Target | null {
  if (!target || !payload) return null;
  const s = getState();
  let build = ''; let step = '';
  if (target === 'axf-orchestrator-build' || target === 'axf-pending-item') build = payload;
  else if (target === 'axf-orchestrator-step') { const [b0 = '', s0 = ''] = payload.split('/'); build = b0; step = s0; }
  else if (target === 'axf-build-item') { const [, id = ''] = payload.split(':'); build = findBuild(id)?.id ?? s.builds.find((b) => b.planId === id || b.pendingId === id)?.id ?? ''; }
  else if (target === 'axf-built-item') build = findBuild(payload)?.id ?? s.builds.find((b) => b.branch && b.branch === payload)?.id ?? '';
  else if (target === 'axf-change-entry') build = s.changes[payload] ?? '';
  else if (target === 'axf-plan') build = s.plans[payload] ?? s.builds.find((b) => b.planId === payload)?.id ?? '';
  else if (target === 'axf-plan-feature') build = s.builds.find((b) => b.planId === payload || b.id === payload)?.id ?? '';
  else return null;
  const b = findBuild(build);
  return b && documentable(b, step) ? { build: b.id, step } : null;
}

const enc = (t: Target) => encodeURIComponent(t.step ? `${t.build}/${t.step}` : t.build);

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Build docs',
  version: '0.1.0',
  appMenu,
  provides: ['axf.build-docs'],
  register(rt: AxfRuntime) {
    void loadIndex();
    const refresh = () => { if (document.visibilityState === 'visible') void loadIndex(); };
    globalThis.addEventListener('focus', refresh);
    setInterval(refresh, 5 * 60_000);
    rt.actions.register('build-docs.docs', ([arg]) => rt.openDialog('build-docs.docs', arg ? { arg } : {}), { label: 'Create documentation for a build', params: true });
    rt.actions.register('build-docs.video', ([arg]) => rt.openDialog('build-docs.video', arg ? { arg } : {}), { label: 'Create a walkthrough video of a build', params: true });
    rt.actions.register('build-docs.script', ([arg]) => arg && rt.openDialog('build-docs.script', { id: decodeURIComponent(arg) }), { label: 'Review a walkthrough script', params: true, searchable: false });
    rt.actions.register('build-docs.open', ([arg]) => { if (arg) setFocus(decodeURIComponent(arg)); rt.navigate('build-docs'); }, { label: 'Docs & videos' });
    // the link a plan's Docs section carries for a video: #/build-docs?job=<id>
    const onHash = () => {
      const m = /^#\/build-docs(?:\?job=([a-z0-9-]+))?$/.exec(globalThis.location?.hash ?? '');
      if (!m) return;
      if (m[1]) setFocus(m[1]);
      rt.navigate('build-docs');
      globalThis.history?.replaceState(null, '', `${location.pathname}${location.search}`);
    };
    globalThis.addEventListener('hashchange', onHash);
    onHash();
    rt.actions.register('build-docs.refresh', () => { void loadIndex(); void loadJobs(); }, { label: 'Refresh Docs & videos' });
    rt.contextExtras.set('*:build-docs', (target, payload) => {
      const t = resolveTarget(target, payload);
      if (!t) return [];
      return [
        { id: 'build-docs.docs', label: 'Create documentation', icon: 'file', action: `build-docs.docs:${enc(t)}` },
        { id: 'build-docs.video', label: 'Create walkthrough video', icon: 'play', action: `build-docs.video:${enc(t)}` },
      ];
    });
    rt.search.add('build-docs.jobs', () => getState().jobs.slice(0, 100).map((j) => ({
      id: `build-docs:${j.id}`, kind: 'build', label: `${j.kind === 'video' ? 'Video' : 'Docs'}: ${j.title}`, icon: j.kind === 'video' ? 'play' : 'file',
      detail: `Docs & videos · ${j.state}`, keywords: [j.id, j.kind, ...j.targets.map((t) => t.build)], focus: { kind: 'action' as const, spec: `build-docs.open:${j.id}` },
    })));
  },
  views: { 'build-docs': { title: 'Docs & videos', icon: 'file', keywords: ['docs', 'documentation', 'video', 'walkthrough', 'record', 'build', 'readme', 'tutorial'], render: () => <JobsPage /> } },
  nav: { label: 'Builds', items: [{ id: 'build-docs', label: 'Docs & videos', icon: 'file', view: 'build-docs' }] },
  dialogs: {
    'build-docs.docs': { title: 'Create documentation', icon: 'file', render: (props, close) => <DocsDialog props={props} close={close} /> },
    'build-docs.video': { title: 'Create walkthrough video', icon: 'play', render: (props, close) => <VideoDialog props={props} close={close} /> },
    'build-docs.script': { title: 'Walkthrough script', icon: 'eye', searchable: false, render: (props, close) => <ScriptDialog props={props} close={close} /> },
  },
  contextMenu: [{ id: 'build-docs.default', target: 'default', order: 94, items: [{ id: 'build-docs', label: 'Docs & videos', icon: 'file', action: 'build-docs.open' }] }],
  settingsTabs: [{ id: FOLDER, label: 'Build docs', icon: 'file', parent: 'plugins', order: 44, description: 'Docs and walkthrough videos of finished builds.' }],
  settings: [{
    id: 'build-docs.defaults', label: 'Defaults for new jobs', icon: 'sliders', tab: FOLDER, order: 10,
    settings: [
      { key: 'build-docs.audience', label: 'Docs audience', kind: 'choice', default: 'me', options: [{ value: 'me', label: 'Me' }, { value: 'developer', label: 'Developer' }, { value: 'end-user', label: 'End user' }] },
      { key: 'build-docs.depth', label: 'Docs depth', kind: 'choice', default: 'standard', options: [{ value: 'brief', label: 'Brief' }, { value: 'standard', label: 'Standard' }, { value: 'deep', label: 'Deep' }] },
      { key: 'build-docs.length', label: 'Video length (seconds)', kind: 'number', default: 60, min: 15, max: 1800 },
      { key: 'build-docs.viewport', label: 'Video viewport', kind: 'choice', default: 'desktop', options: [{ value: 'desktop', label: 'Desktop' }, { value: 'phone', label: 'Phone' }] },
      { key: 'build-docs.narration', label: 'Narration', kind: 'toggle', default: true },
      { key: 'build-docs.captions', label: 'Captions burned in', kind: 'toggle', default: true },
    ],
  }],
  settingsPanels: [
    { id: 'build-docs.status', tab: FOLDER, title: 'Now', icon: 'clock', order: 5, render: () => <SettingsSummary /> },
    { id: 'build-docs.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
