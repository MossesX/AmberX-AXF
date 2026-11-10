/**
 * Inline edit console plugin (ai.amberx.axf.console.inline-edit), build inline-element-editing-plugin-right-click-any-el.
 *
 * Brett (Nov 10 2026): "Right-click elements right down to the child, it opens a dialog with all the different tokens …
 * edit every token, notes that it overrides inheritance. A master switch in the main application settings to enable
 * inline edit mode … a monster list of everything changed from axHub's inheritance, reset them individually to axHub's."
 *
 *   master switch  Settings → Appearance → Inline edit (and Settings → Plugins → Inline edit): `axf.inline-edit.mode`,
 *                  kept on the server and mirrored here (mode.ts); on = the s3 capture layer is attached, off = detached
 *   dialog         `inline-edit-element`: the element's breadcrumb, scope, the tokens in three views, editors (dialog.tsx)
 *   page           `inline-edit-overrides`: every override, tree + search + filters + tabs + reset (overrides.tsx)
 *   applier        saved records restyle the elements they address, live; the dialog previews through it (apply.ts)
 *
 * Deep links (console_open / console_show / console_dialog / console_settings): settings `inline-edit`
 * ("settings/inline-edit"), dialog `inline-edit-element` with arg "path=…&scope=…&view=…", screen
 * `inline-edit-overrides`, and the navigate actions `inline-edit.element:<arg>` / `inline-edit.overrides:<arg>`.
 */
import { useEffect, useState } from 'react';
import { Button, Note, Switch, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { bindInlineEditMode, createInlineEditCapture, inlineEditModeOn, INLINE_EDIT_MODE_KEY } from '../../../framework/index.mjs';
import { FOLDER, parseArg, setElementUi, setMode, setOverridesState, errText } from './api';
import { startApplier, type Applier } from './apply';
import { startModeSync } from './mode';
import { ElementDialog, DIALOG, setApplier } from './dialog';
import { OverridesPage, VIEW } from './overrides';
import { appMenu } from './menu';
import './inline-edit.css';

const ID = 'ai.amberx.axf.console.inline-edit';
const TAB = 'inline-edit';
const MODE_DESCRIPTION = 'On: right-click any element of the console, down to the child (menu rows, nav items, toolbar buttons, banner widgets, tabs), to edit its tokens. A change overrides what the element inherits from axHub. Alt + right-click still opens the normal menu.';

/** Open the edit dialog for a path (from the capture layer, an action or a deep link) and record it as the dialog's state. */
export function openElement(rt: AxfRuntime, arg: string): void {
  const a = parseArg(arg);
  if (a.path || a.scope || a.view) void setElementUi({ ...(a.path ? { path: a.path } : {}), ...(a.scope ? { scope: a.scope } : {}), ...(a.view ? { view: a.view } : {}) }).catch(() => undefined);
  rt.openDialog(DIALOG, { arg });
}
/** Open the overrides page, applying any root / q / filter / tab from the deep link first. */
export async function openOverrides(rt: AxfRuntime, arg: string): Promise<void> {
  const a = parseArg(arg);
  const patch: Record<string, unknown> = {};
  if (a.tab) patch.tab = a.tab;
  if (a.root !== undefined) patch.root = a.root;
  if (a.q !== undefined) patch.q = a.q;
  if (a.filter !== undefined) { try { patch.filter = JSON.parse(a.filter); } catch { patch.filter = a.filter; } }
  if (Object.keys(patch).length) { try { await setOverridesState(patch); } catch (e) { rt.toast(errText(e), 'danger', 'Inline edit'); } }
  rt.navigate(VIEW);
}

function ModePanel() {
  const rt = useRuntime();
  const [on, setOn] = useState(() => inlineEditModeOn(rt.settings.get(INLINE_EDIT_MODE_KEY)));
  useEffect(() => rt.settings.onChange(INLINE_EDIT_MODE_KEY, (v) => setOn(inlineEditModeOn(v))), [rt]);
  return (
    <div className="axp-inline-edit__panel">
      <Switch label="Inline edit mode" checked={on} onChange={(v) => rt.settings.set(INLINE_EDIT_MODE_KEY, v)} hint={MODE_DESCRIPTION} />
      <Note tone="info" icon="info">Changes made in the edit dialog override axHub inheritance under the existing override rules. Every one of them is listed under Overrides, where each can be reset to axHub on its own.</Note>
      <div className="fx-row fx-row--wrap">
        <Button icon="layers" onClick={() => rt.navigate(VIEW)}>Open the overrides list</Button>
      </div>
    </div>
  );
}

let applier: Applier | null = null;

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Inline edit',
  version: '0.1.0',
  uiEditor: ['style'],
  appMenu,
  register(rt) {
    const warn = (msg: string) => rt.toast(msg, 'danger', 'Inline edit');
    startModeSync(rt, warn);
    const capture = createInlineEditCapture({ doc: document, onOpen: (d) => openElement(rt, d.path) });
    bindInlineEditMode(capture, rt.settings);
    applier = startApplier(document);
    setApplier(applier);

    const mode = (state: 'on' | 'off' | 'toggle') => () => {
      const next = state === 'toggle' ? !inlineEditModeOn(rt.settings.get(INLINE_EDIT_MODE_KEY)) : state === 'on';
      rt.settings.set(INLINE_EDIT_MODE_KEY, next); // mode.ts writes it to the server
      void setMode(next ? 'on' : 'off').catch((e: unknown) => warn(errText(e)));
    };
    rt.actions.register('inline-edit.mode.toggle', mode('toggle'), { label: 'Inline edit mode on / off', effect: 'write' });
    rt.actions.register('inline-edit.mode.on', mode('on'), { label: 'Inline edit mode on', effect: 'write' });
    rt.actions.register('inline-edit.mode.off', mode('off'), { label: 'Inline edit mode off', effect: 'write' });
    rt.actions.register('inline-edit.element', (args) => openElement(rt, args.join(':')), { label: 'Edit an element\'s tokens', params: true, effect: 'navigate' });
    rt.actions.register('inline-edit.overrides', (args) => void openOverrides(rt, args.join(':')), { label: 'Inline edit overrides list', effect: 'navigate' });
    rt.actions.register('inline-edit.settings', () => rt.dispatch(`settings.open:${TAB}`), { label: 'Inline edit settings', effect: 'navigate' });
  },
  views: {
    'inline-edit-overrides': { title: 'Inline edit overrides', icon: 'layers', render: () => <OverridesPage />, keywords: ['overrides', 'inline edit', 'reset to axhub', 'changed tokens', 'inheritance'] },
  },
  dialogs: {
    [DIALOG]: { title: 'Edit element', icon: 'edit', render: (props, close) => <ElementDialog arg={typeof props.arg === 'string' ? props.arg : typeof props.path === 'string' ? props.path : ''} close={close} /> },
  },
  nav: { label: 'Plugins', items: [{ id: 'inline-edit-overrides', label: 'Inline edit overrides', icon: 'layers', view: 'inline-edit-overrides' }] },
  contextMenu: [
    { id: 'inline-edit.default', target: 'default', order: 92, items: [
      { id: 'inline-edit.mode', label: 'Inline edit mode', icon: 'edit', action: 'inline-edit.mode.toggle' },
      { id: 'inline-edit.overrides', label: 'Inline edit overrides', icon: 'layers', action: 'inline-edit.overrides' },
    ] },
  ],
  settingsTabs: [{ id: TAB, label: 'Inline edit', icon: 'edit', order: 30, parent: 'plugins', description: 'The inline edit master switch, the overrides list and the plugin itself.' }],
  settings: [
    // the master switch in the main application settings (Brett: "A master switch in the main application settings")
    { id: 'inline-edit.mode', tab: 'appearance', label: 'Inline edit', icon: 'edit', order: 5, settings: [
      { key: INLINE_EDIT_MODE_KEY, label: 'Inline edit mode', kind: 'toggle', default: false, description: MODE_DESCRIPTION },
      { key: 'inline-edit.overrides', label: 'Overrides list', kind: 'action', target: 'inline-edit.overrides', icon: 'layers', description: 'Every value changed from axHub inheritance; reset any one of them.' },
    ] },
  ],
  settingsPanels: [
    { id: 'inline-edit.switch', tab: TAB, title: 'Inline edit mode', icon: 'edit', order: 5, render: () => <ModePanel /> },
    { id: 'inline-edit.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
