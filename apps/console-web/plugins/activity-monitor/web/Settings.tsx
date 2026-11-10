import { useEffect } from 'react';
import { Note, SelectField, Switch, TextField } from '@console/axf/react';
import { loadSettings, saveSettings, useStore, type Settings } from './store';

const KINDS = ['click', 'action', 'command', 'axhub', 'approval', 'veto', 'agent', 'crew', 'orchestrator', 'build', 'session', 'error', 'fix', 'rule', 'system'];
const TOKENS = ['accent', 'info', 'success', 'warning', 'danger', 'muted', 'text', 'focus'];

/** Display: density, layout, follow, colours per kind (theme colour names, so a theme swap recolours the log). */
export function DisplayPanel() {
  const s = useStore().settings;
  useEffect(() => { void loadSettings(); }, []);
  if (!s) return <Note tone="info">Loading the log's settings…</Note>;
  const put = (patch: Partial<Settings>) => void saveSettings(patch);
  return (
    <div className="fx-stack axp-activity-monitor__settings">
      <SelectField label="Density" value={s.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'roomy', label: 'Roomy' }]} onChange={(density) => put({ density: density as Settings['density'] })} />
      <SelectField label="Layout" value={s.view} options={[{ value: 'tree', label: 'Chains (one request and what followed)' }, { value: 'flat', label: 'Lines' }]} onChange={(view) => put({ view: view as Settings['view'] })} />
      <Switch label="Live follow by default" checked={s.follow} onChange={(follow) => put({ follow })} />
      <Switch label="One tab per app" checked={s.appTabs} onChange={(appTabs) => put({ appTabs })} />
      <TextField label="Refresh every (ms)" type="number" value={String(s.pollMs)} onChange={(x) => put({ pollMs: Number(x) || 2000 })} />
      <p className="axp-activity-monitor__rulelead">Colour per kind</p>
      <div className="axp-activity-monitor__grid">
        {KINDS.map((k) => (
          <SelectField key={k} label={k} value={s.colors[k] ?? 'accent'} options={TOKENS.map((t) => ({ value: t, label: t }))} onChange={(t) => put({ colors: { [k]: t } })} />
        ))}
      </div>
    </div>
  );
}

/** What to show and what to record. */
export function ShowPanel() {
  const s = useStore().settings;
  useEffect(() => { void loadSettings(); }, []);
  if (!s) return null;
  const put = (patch: Partial<Settings>) => void saveSettings(patch);
  const hidden = new Set(s.hide);
  const flip = (k: string, show: boolean) => put({ hide: show ? s.hide.filter((x) => x !== k) : [...s.hide, k] });
  return (
    <div className="fx-stack axp-activity-monitor__settings">
      <Switch label="Record every tap in the console" checked={s.captureClicks} onChange={(captureClicks) => put({ captureClicks })} />
      <Switch label="Record every console action (menus, shortcuts, toolbars)" checked={s.captureActions} onChange={(captureActions) => put({ captureActions })} />
      <Switch label="Record errors on the console page" checked={s.captureErrors} onChange={(captureErrors) => put({ captureErrors })} />
      <Switch label="Read the builds store, axHub runs, the activity feed, fix notes and the console terminal" checked={s.collect} onChange={(collect) => put({ collect })} />
      <TextField label="Events kept" type="number" value={String(s.keep)} onChange={(x) => put({ keep: Number(x) || 20000 })} />
      <p className="axp-activity-monitor__rulelead">Show in the log</p>
      <div className="axp-activity-monitor__grid">
        {[...KINDS, 'debug'].map((k) => <Switch key={k} label={k} checked={!hidden.has(k)} onChange={(on) => flip(k, on)} />)}
      </div>
    </div>
  );
}
