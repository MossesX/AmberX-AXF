/**
 * Hub plugin (hub-console@1): every axHub web page as a console screen. One view (`hub`) with a TabGroup row
 * (`hub.tabs`) drawn from the route table framework/schemas/hub-console.json, one tab per hub screen, in the table's
 * order. The screens land step by step (Approvals first); until a screen's part lands, its tab shows what it will read
 * and what it will let Brett do, straight from the table, so nothing here is invented twice.
 *
 * Decisions (approve, deny, shelve, grant, delete, create a token) are Brett's own tap through the approvals-banner
 * relay and are registered personOnly: no session, tool, CLI line or voice action runs them (HUB-CONSOLE.md → who).
 */
import { Chip, Container, Note, TabGroup } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import table from '@console/axf/schemas/hub-console.json';
import { homeScreen, screensOf, type HubConsoleTable, type HubScreen } from '@console/axf/core/hub-console.mjs';
import { appMenu } from './menu';
import { FOLDER, VIEW } from './ids';
import { ApprovalsScreen } from './approvals';
import { registerHubActions } from './actions';
import { setActiveScreen, useActiveScreen } from './store';
import './hub-admin.css';

export { FOLDER, VIEW };
export const TABLE = table as HubConsoleTable;
export const SCREENS = screensOf(TABLE);

const WHO_LABEL: Record<string, string> = { person: "Brett's tap only", confirm: 'command with confirm', command: 'command' };
const WHO_TONE: Record<string, 'warning' | 'accent' | undefined> = { person: 'warning', confirm: 'accent', command: undefined };

/** Until a screen lands: the table's own account of what it reads and what it lets Brett do. */
function ScreenPlaceholder({ screen }: { screen: HubScreen }) {
  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen={screen.id}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · {screen.gate === 'admin' ? 'admins' : screen.gate === 'user' ? 'signed-in accounts' : 'everyone'}</p>
          <h1>{screen.title}</h1>
          <p className="fx-muted">This screen is on its way. What it will show and do comes from the hub-console@1 route table.</p>
        </div>
      </header>
      <Container title="What it reads" icon="cloud">
        <div className="fx-stack">
          <p className="fx-mono">{screen.state.hub}</p>
          <div className="fx-row fx-row--wrap">
            {screen.state.fields.map((f) => <Chip key={f}>{f}</Chip>)}
          </div>
        </div>
      </Container>
      <Container title="What it lets you do" icon="shield">
        <table className="fx-table">
          <tbody>
            {screen.actions.map((a) => (
              <tr key={a.id}>
                <th>{a.label}</th>
                <td><Chip tone={WHO_TONE[a.who]}>{WHO_LABEL[a.who] ?? a.who}</Chip>{a.missing ? <span className="fx-muted"> · the hub has no route for this yet</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Container>
      {screen.replaces.length > 0 && <Note tone="info" icon="info">Replaces {screen.replaces.join(', ')} on axhub.amberxai.com.</Note>}
    </div>
  );
}

/** The screen renderers, filled in as the screens land; a screen without one shows its placeholder. */
export const SCREEN_RENDERERS: Partial<Record<string, (screen: HubScreen) => JSX.Element>> = {
  approvals: (screen) => <ApprovalsScreen screen={screen} />,
};

export function HubPage() {
  const active = useActiveScreen(homeScreen(TABLE)?.id ?? SCREENS[0]!.id);
  const screen = SCREENS.find((s) => s.id === active) ?? SCREENS[0]!;
  const render = SCREEN_RENDERERS[screen.id];
  return (
    <div className="fx-stack fx-stack--lg" data-axf-view={VIEW}>
      <TabGroup id={TABLE.tabRow} label="Hub screens" value={screen.id} onChange={setActiveScreen} tabs={SCREENS.map((s) => ({ value: s.id, label: s.title, icon: s.icon, title: s.title }))}>
        {render ? render(screen) : <ScreenPlaceholder screen={screen} />}
      </TabGroup>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.hub-admin', // must equal plugin.json "id"
  label: 'Hub',
  version: '0.1.0',
  provides: ['axf.hub-console@1'],
  register: (rt) => registerHubActions(rt, TABLE),
  appMenu,
  views: { [VIEW]: { title: 'Hub', icon: 'shield', keywords: ['axhub', 'hub', 'approvals', 'passes', 'veto', 'users', 'account', 'connectors', 'services', 'handoff', 'auth'], render: () => <HubPage /> } },
  nav: { label: 'Hub', items: [{ id: VIEW, label: 'Hub', icon: 'shield', view: VIEW }] },
  // Plugins never ship their own settings screen: a sub-tab of Settings → Plugins, with the shared lifecycle panel.
  settingsTabs: [{ id: TABLE.settingsSubtab, label: 'Hub', icon: 'shield', order: 60, parent: 'plugins' }],
  settingsPanels: [{ id: 'hub.lifecycle', tab: TABLE.settingsSubtab, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
