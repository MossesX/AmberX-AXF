/**
 * Reference links (web part). The framework's RefText already links every mention of a screen, dialog, settings tab,
 * section or setting, action, asset, plugin and build the console's search index knows. This adds what only the
 * server knows: every build in the builds store with its declared `touches:` (so a peek card can say "being changed
 * by <build>, not live yet"), its PR and, for builds in progress, their UI Review items; and the agents.
 *
 * Settings → Plugins → Reference links: on / off, and a box to try a line of text.
 */
import { useEffect, useState } from 'react';
import { Note, REFS_SETTING, RefText, TextField, addRefSource, refSourcesChanged, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import type { RefTarget } from '@console/axf/core/engines/refs.mjs';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './ref-links.css';

const FOLDER = 'ref-links';
const ID = 'ai.amberx.axf.console.ref-links';
const KEY = REFS_SETTING;
const REFRESH_MS = 2 * 60_000;

let targets: RefTarget[] = [];
async function load(): Promise<void> {
  try {
    const j = await pluginFetch(FOLDER, 'targets').then((r) => r.json()) as { ok?: boolean; targets?: RefTarget[] };
    if (j.ok && Array.isArray(j.targets)) { targets = j.targets; refSourcesChanged(); }
  } catch { /* server part down: keep the last list */ }
}

/** Mounted once on the page (slot app.frame.cover): keeps the server's targets fresh, draws nothing. */
function RefSourceClient() {
  useEffect(() => {
    const off = addRefSource('ref-links.server', () => targets);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    globalThis.addEventListener('focus', onFocus);
    return () => { off(); clearInterval(timer); globalThis.removeEventListener('focus', onFocus); };
  }, []);
  return null;
}

const SAMPLE = 'Editing the Terminal settings and the Plan Studio screen for banner-ref-links (PR 254); see apps/console-web/plugins/push-banner.';

function TryPanel() {
  const rt = useRuntime();
  const [text, setText] = useState(SAMPLE);
  const on = rt.settings.get(KEY) !== false;
  return (
    <div className="fx-stack">
      {!on && <Note tone="info">Links are off. Turn on “Link mentions in banner text” above to see them.</Note>}
      <TextField label="A line of text" value={text} onChange={setText} />
      <p className="axp-ref-links__try"><RefText text={text} /></p>
      <Note tone="info">Tap a link for what it is, double-tap to open it, hold (or right-click) for more. Claude sessions use <code>ref_links_find</code>, <code>ref_links_resolve</code> and <code>ref_links_open</code>; REST <code>POST /api/control/ref-links/open</code>; CLI <code>axf ref-links open "Terminal settings"</code>.</Note>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Reference links',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  appMenu,
  slots: { 'app.frame.cover': [{ id: 'ref-links.source', order: 98, render: () => <RefSourceClient /> }] },
  settingsTabs: [{ id: FOLDER, label: 'Reference links', icon: 'info', order: 93, parent: 'plugins', description: 'Mentions of screens, settings, plugins, builds and PRs in banner text open what they refer to' }],
  settings: [{
    id: 'ref-links.prefs', label: 'Reference links', icon: 'info', tab: FOLDER, order: 10,
    description: 'Text in the banners that names a part of the app (a screen, a settings page, a plugin, a toolbar, a build, a PR) is a link.',
    settings: [
      { key: KEY, label: 'Link mentions in banner text', kind: 'toggle', default: true, scope: 'device', description: 'Tap = what it is, double-tap = open it, hold = more. Off: the text is plain.' },
    ],
  }],
  settingsPanels: [
    { id: 'ref-links.try', tab: FOLDER, title: 'Try it', icon: 'edit', order: 20, render: () => <TryPanel /> },
    { id: 'ref-links.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
