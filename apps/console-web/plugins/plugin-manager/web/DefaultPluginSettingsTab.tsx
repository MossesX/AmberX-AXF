/**
 * The default sections of every plugin's Settings → Plugins sub-tab (plugin-settings@1: enable, info, logs).
 *
 * Brett, Nov 16 2026: "They all need a settings page. They all need a settings interface." Every plugin gets this
 * panel at the top of its sub-tab, whether or not it ships settings of its own; a plugin's own groups and panels follow
 * it in the same tab (src/settings/pluginTabs.ts merges them). The data is the Plugin Manager's model, so the switch,
 * the facts and the log lines are the same as in the manager's detail pane:
 *
 *   enable  the console's own route (POST /api/plugins/<folder>/enabled), the same as the manager's Enable button
 *   info    version, built-with badge, description and dependencies from plugin-inventory@1 (core/engines/plugins.ts)
 *   logs    its most recent console log lines (GET /api/plugins/plugin-manager/logs/<folder>)
 *
 * Built only from framework controls (Section, Switch, Chip, ModelBadge, Button, Note); its few layout classes are
 * axp-plugin-manager-* rules on tokens in plugin-manager.css.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, ModelBadge, Note, Section, Switch, useRuntime } from '@console/axf/react';
import { PLUGINS_CHANGED } from '@console/plugins';
import { setEnabled } from './actions';
import './plugin-manager.css';
import { DEP_LABEL, DEP_TONE, loadInventory, loadLogs, type Inventory, type LogLine, type PluginRow } from './model';

/** How many log lines the tab shows (the Plugin Manager's Logs tab has the full list and the level filter). */
export const RECENT_LOGS = 12;
/** The inventory is shared by every open plugin tab for a few seconds, so switching sub-tabs doesn't refetch it. */
const TTL_MS = 5000;
let cached: { at: number; inv: Promise<Inventory> } | null = null;
function inventory(fresh = false): Promise<Inventory> {
  if (fresh || !cached || Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), inv: loadInventory() };
  return cached.inv;
}

export interface DefaultPluginSettingsTabProps {
  /** the plugin's folder under apps/console-web/plugins */
  folder: string;
  /** the sections to draw, in order (plugin-settings@1 sections; the console draws enable, info and logs here) */
  sections?: readonly string[];
}

export function DefaultPluginSettingsTab({ folder, sections = ['enable', 'info', 'logs'] }: DefaultPluginSettingsTabProps) {
  const [row, setRow] = useState<PluginRow | null | undefined>(undefined);
  const reload = (fresh = false) => { void inventory(fresh).then((inv) => setRow(inv.items.find((r) => r.folder === folder) ?? null)); };
  useEffect(() => {
    reload();
    const on = () => reload(true);
    globalThis.addEventListener(PLUGINS_CHANGED, on);
    return () => globalThis.removeEventListener(PLUGINS_CHANGED, on);
  }, [folder]); // eslint-disable-line react-hooks/exhaustive-deps
  if (row === undefined) return <p className="fx-muted fx-small">Loading…</p>;
  if (row === null) return <Note tone="warning">The Plugin Manager doesn't list plugins/{folder}.</Note>;
  return (
    <div className="fx-stack axp-plugin-manager-defaults" data-axf-plugin-defaults={folder}>
      {sections.map((s) => {
        if (s === 'enable') return <EnableSection key={s} row={row} />;
        if (s === 'info') return <InfoSection key={s} row={row} />;
        if (s === 'logs') return <LogsSection key={s} row={row} />;
        return null;
      })}
    </div>
  );
}

function EnableSection({ row }: { row: PluginRow }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const toggle = async (on: boolean) => { setBusy(true); await setEnabled(rt, row, on); setBusy(false); };
  return (
    <Section title="Enabled">
      <Switch
        label={`${row.name} is on`}
        checked={row.enabled}
        disabled={busy || row.removed}
        onChange={(on) => void toggle(on)}
        hint={row.enabled ? 'Switching it off hides its screens, menu items and settings until it is switched back on here.' : 'Off: its screens, menu items and own settings are hidden. Switch it on to use it.'}
      />
    </Section>
  );
}

function InfoSection({ row }: { row: PluginRow }) {
  const rt = useRuntime();
  const unmet = row.dependencies.filter((d) => d.required && d.status !== 'ok' && d.status !== 'set' && d.status !== 'granted');
  return (
    <Section title="About" aside={<Button size="sm" tone="ghost" icon="package" onClick={() => rt.dispatch(`plugin-manager.open:${row.folder}`)}>Plugin Manager</Button>}>
      <div className="fx-row fx-row--wrap">
        <Chip>v{row.version}</Chip>
        <ModelBadge model={row.builtWith?.model} builtAt={row.builtWith?.builtAt} />
        <Chip tone={row.enabled ? 'success' : undefined}>{row.enabled ? 'enabled' : 'disabled'}</Chip>
      </div>
      {row.description ? <p className="axp-plugin-manager-desc">{row.description}</p> : null}
      <p className="fx-mono fx-small fx-muted">{row.id} · plugins/{row.folder}</p>
      <h4 className="axp-plugin-manager-h">Dependencies</h4>
      {row.dependencies.length === 0 ? <p className="fx-muted fx-small">It needs nothing beyond the console.</p> : (
        <ul className="axp-plugin-manager-defaults__deps">
          {row.dependencies.map((d) => (
            <li key={`${d.kind}:${d.name}`} className="fx-row fx-row--wrap">
              <code>{d.name}</code>
              <Chip>{d.required ? 'required' : 'optional'}</Chip>
              <Chip tone={DEP_TONE(d.status)}>{DEP_LABEL[d.status] ?? d.status}</Chip>
            </li>
          ))}
        </ul>
      )}
      {unmet.length ? <Note tone="warning">{unmet.length} required dependenc{unmet.length > 1 ? 'ies are' : 'y is'} not met.</Note> : null}
      {row.dependents.length ? <p className="fx-muted fx-small">Used by {row.dependents.map((d) => d.name).join(', ')}.</p> : null}
    </Section>
  );
}

function LogsSection({ row }: { row: PluginRow }) {
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const load = () => { setLines(null); void loadLogs(row.folder).then((l) => setLines(l.slice(-RECENT_LOGS))); };
  useEffect(load, [row.folder]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Section title="Recent logs" aside={<Button size="sm" tone="ghost" icon="refresh" onClick={load}>Refresh</Button>}>
      {lines === null ? <p className="fx-muted fx-small">Loading…</p> : lines.length === 0 ? <p className="fx-muted fx-small">No log lines from or about {row.name} yet.</p> : (
        <ol className="axp-plugin-manager-log">
          {[...lines].reverse().map((l, i) => (
            <li key={`${l.at}-${i}`} className={`axp-plugin-manager-log__line is-${l.level}`}>
              <span className="axp-plugin-manager-log__time">{new Date(l.at).toLocaleTimeString()}</span>
              <span className="axp-plugin-manager-log__level">{l.level}</span>
              <span className="axp-plugin-manager-log__text">{l.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
