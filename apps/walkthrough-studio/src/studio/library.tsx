/**
 * The studio as an AXF web library: its settings live under Settings → Plugins → Walkthrough Studio (the framework
 * rule: no settings screen of its own), its views reach the app menu and search through the shell.
 */
import { Button, SelectField, Switch, useRuntime } from '../axf/react';
import type { AxfWebLibrary } from '../axf/react';
import { studio, useStudio } from './store';
import { LAYOUTS, ui, useUi } from './ui';

function StudioSettings() {
  const rt = useRuntime();
  const hub = useStudio((s) => s.hub);
  const layout = useUi((s) => s.layout);
  const n = useUi((s) => s.toolbars.length);
  return (
    <div className="fx-stack">
      <Switch label="Keep projects on axHub" checked={hub.on} onChange={(v) => studio().setHub(v)} hint={hub.error ?? `Projects are saved on this device; switched on they also go to ${hub.address || 'axHub'}'s data server under walkthrough-studio/ (a head document and piece chunks under 64 KB each). Screen video stays on this device.`} />
      <SelectField label="Workspace layout" value={layout} options={LAYOUTS.map((l) => ({ value: l.id, label: `${l.label} — ${l.description}` }))} onChange={(v) => ui.setLayout(v)} />
      <div className="fx-row fx-row--wrap">
        <Button size="sm" icon="refresh" onClick={() => ui.resetLayout()}>Reset this layout</Button>
        <Button size="sm" icon="sliders" onClick={() => rt.dispatch('ws.toolbars.customize')}>Customize toolbars ({n})</Button>
        <Button size="sm" tone="quiet" icon="refresh" onClick={() => ui.resetToolbars()}>Back to the two default toolbars</Button>
      </div>
    </div>
  );
}

export const studioLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.walkthrough-studio',
  label: 'Walkthrough Studio',
  version: '0.1.0',
  settingsTabs: [{ id: 'walkthrough-studio', label: 'Walkthrough Studio', icon: 'monitor', order: 10, parent: 'plugins', description: 'Where projects are kept, the workspace layout and the toolbars.' }],
  settingsPanels: [{ id: 'walkthrough-studio.main', tab: 'walkthrough-studio', title: 'Studio', icon: 'monitor', render: () => <StudioSettings /> }],
};
