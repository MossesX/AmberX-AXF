import { useState } from 'react';
import { Button, Chip, Container, DockArea, useRuntime, useWindowManager } from '../axf/react';
import { useStore } from '../store';

/** A library the console can build: a module id + the catalog features it should cover. */
export interface LibraryDef { id: string; module: string; label: string; description: string; features: string[]; packageName: string }
export const LIBRARIES: LibraryDef[] = [
  { id: 'settings', module: 'ai.amberx.axf.settings', label: 'Settings', description: 'Schema-driven settings + generated UI', features: ['s.settings', 's.prefs', 's.scopes', 's.secure', 's.searchable'], packageName: 'lib-settings' },
  { id: 'logging', module: 'ai.amberx.axf.logging', label: 'Logging', description: 'Levels, sinks, viewer, crash capture, diagnostics', features: ['l.log', 'l.viewer', 'l.crash', 'l.net', 'l.perf', 'l.remote', 'l.diag'], packageName: 'lib-logging' },
  { id: 'admin', module: 'ai.amberx.axf.admin', label: 'Administration', description: 'Roles, policies, flags, remote config, module toggles, audit', features: ['a.admin', 'a.audit', 'a.users', 'a.content', 'a.maint', 'a.devicemgmt'], packageName: 'lib-admin' },
  { id: 'accounts', module: 'ai.amberx.axf.accounts', label: 'Accounts', description: 'Sign-in, OAuth, passkeys, biometrics, sessions, 2FA, GDPR', features: ['u.accounts', 'u.auth', 'u.bio', 'u.sessions', 'u.recovery', 'u.roles', 'u.guest', 'u.gdpr'], packageName: 'lib-accounts' },
  { id: 'profile', module: 'ai.amberx.axf.profile', label: 'Profile', description: 'Avatar, details, privacy, sync, public profile', features: ['p.profile', 'p.avatar', 'p.sync', 'p.public', 'p.activity'], packageName: 'lib-profile' },
  { id: 'billing', module: 'ai.amberx.axf.billing', label: 'Billing', description: 'Plans, paywall, Play Billing, entitlements, IAP, promos', features: ['b.subs', 'b.billing', 'b.entitle', 'b.iap', 'b.promo', 'b.license', 'b.ads', 'b.stripe'], packageName: 'lib-billing' },
  { id: 'browser', module: 'ai.amberx.axf.browser', label: 'Library browser', description: 'Floating tab-group browser: two panes, multi-select, compare → undock / split / grid; attaches to any tab group in the manifest; installable with a wizard', features: ['lib.browser', 'ui.windows', 'ui.explorer'], packageName: 'lib-browser' },
  { id: 'media', module: 'ai.amberx.axf.media', label: 'Media', description: 'Video/audio playback, camera, streaming, PiP', features: ['dv.media', 'dv.stream', 'dv.camera', 'dv.audio', 'c.video', 'c.vpsstream', 'c.camera', 'c.music'], packageName: 'lib-media' },
  { id: 'location', module: 'ai.amberx.axf.location', label: 'Location', description: 'GPS, geofences, maps, trails', features: ['dv.loc', 'dv.maps', 'c.gps'], packageName: 'lib-location' },
  { id: 'editor', module: 'ai.amberx.axf.editor', label: 'Editors', description: 'Rich text, markdown, code editor, diff', features: ['ui.editor', 'c.texteditor', 'c.json', 'c.pdf'], packageName: 'lib-editor' },
  { id: 'ai', module: 'ai.amberx.axf.ai', label: 'AI assistant', description: 'Claude/OpenAI/Gemini providers, streaming, tools, MCP', features: ['w.ai', 'w.mcp', 'c.ai', 'c.aiimage'], packageName: 'lib-ai' },
  { id: 'vps', module: 'ai.amberx.axf.vps', label: 'VPS & deploy', description: 'SSH/SFTP, deploy wizard, server monitoring, Coolify, Hostinger', features: ['w.vps', 'w.coolify', 'w.hostinger', 'c.terminal', 'c.deploy', 'c.servermon', 'c.logtail', 'c.dns', 'c.cron'], packageName: 'lib-vps' },
  { id: 'github', module: 'ai.amberx.axf.github', label: 'GitHub', description: 'Repos, commits, Actions, releases, tracker sync', features: ['w.github', 'c.github', 'cx.github'], packageName: 'lib-github' },
  { id: 'work', module: 'ai.amberx.axf.work', label: 'Background work', description: 'WorkManager scheduler, alarms, foreground services', features: ['dv.bg', 'k.scheduler'], packageName: 'lib-work' },
  { id: 'notifications', module: 'ai.amberx.axf.notifications', label: 'Notifications & push', description: 'Channels, actions, scheduled, FCM/self-hosted push', features: ['dv.notif', 'w.push', 'c.notifications', 'c.push'], packageName: 'lib-notifications' },
  { id: 'sensors', module: 'ai.amberx.axf.sensors', label: 'Sensors & connectivity', description: 'Sensors, BLE, NFC, Wi-Fi tools', features: ['dv.sensors', 'dv.ble', 'dv.nfc', 'dv.wifi', 'c.sensors', 'c.ble', 'c.nfc', 'c.wifi'], packageName: 'lib-sensors' },
  { id: 'files', module: 'ai.amberx.axf.files', label: 'Files & sync', description: 'File manager, transfer, backup, offline sync', features: ['d.files', 'd.sync', 'd.backup', 'c.files', 'c.transfer', 'c.backup', 'c.offline'], packageName: 'lib-files' },
  { id: 'charts', module: 'ai.amberx.axf.charts', label: 'Charts & tables', description: 'Charts, data grids, dashboards', features: ['ui.charts', 'ui.tables', 'c.charts'], packageName: 'lib-charts' },
  { id: 'plugins', module: 'ai.amberx.axf.plugins', label: 'Plugins & add-ons', description: 'Plugin loader, packs, OTA asset packs, designer bridge', features: ['k.plugins', 'k.nocode', 'w.ota'], packageName: 'lib-plugins' },
];

/** A UI library the framework knows about: hot-swappable AXF kits, or third-party/existing libraries with an adapter status. */
export interface UiLibrary { id: string; name: string; vendor: string; stack: string; status: string; note: string; kitId?: string | null; port: 'android' | 'web' | 'python' }
export const UI_LIBRARIES: UiLibrary[] = [
  { id: 'm3', name: 'Material 3 (Compose)', vendor: 'Google', stack: 'androidx.compose.material3', status: 'adapter', note: "The Android port's built-in kit.", kitId: 'material3', port: 'android' },
  { id: 'unstyled', name: 'Compose Foundation (unstyled)', vendor: 'Google', stack: 'androidx.compose.foundation', status: 'adapter', note: 'Headless kit built from foundation only.', kitId: 'unstyled', port: 'android' },
  { id: 'axf-web', name: 'AXF web components', vendor: 'AmberX', stack: 'framework/react', status: 'active', note: "The web port's built-in kit (CSS tokens).", kitId: 'axf', port: 'web' },
  { id: 'm2', name: 'Material 2 (Compose)', vendor: 'Google', stack: 'androidx.compose.material', status: 'planned', note: 'Kit mapping ComponentKind → Material 2 widgets.', port: 'android' },
  { id: 'cupertino', name: 'Compose Cupertino', vendor: 'alexzhirkevich', stack: 'io.github.alexzhirkevich:cupertino', status: 'planned', note: 'iOS-style widgets; kit covers controls + sheets.', port: 'android' },
  { id: 'composables', name: 'Compose Unstyled', vendor: 'composables.com', stack: 'com.composables:core', status: 'planned', note: 'Accessible headless primitives.', port: 'android' },
  { id: 'glance', name: 'Jetpack Glance', vendor: 'Google', stack: 'androidx.glance', status: 'planned', note: 'Home-screen widgets; kit covers WIDGET kinds only.', port: 'android' },
  { id: 'lottie', name: 'Lottie Compose', vendor: 'Airbnb', stack: 'com.airbnb.android:lottie-compose', status: 'planned', note: 'Animations for the motion-pack asset.', port: 'android' },
  { id: 'vico', name: 'Vico charts', vendor: 'patrykandpatrick', stack: 'com.patrykandpatrick.vico', status: 'planned', note: 'CHART kind.', port: 'android' },
  { id: 'maplibre', name: 'MapLibre', vendor: 'MapLibre', stack: 'org.maplibre.gl', status: 'planned', note: 'MAP kind.', port: 'android' },
  { id: 'media3', name: 'Media3 UI', vendor: 'Google', stack: 'androidx.media3:media3-ui', status: 'planned', note: 'MEDIA_PLAYER kind.', port: 'android' },
  { id: 'mui', name: 'MUI', vendor: 'MUI', stack: '@mui/material', status: 'planned', note: 'React kit for the web port.', port: 'web' },
  { id: 'shadcn', name: 'shadcn/ui', vendor: 'shadcn', stack: 'https://github.com/shadcn-ui/ui', status: 'planned', note: 'React kit for the web port.', port: 'web' },
  { id: 'chakra', name: 'Chakra UI', vendor: 'Chakra', stack: '@chakra-ui/react', status: 'planned', note: 'React kit for the web port.', port: 'web' },
  { id: 'antd', name: 'Ant Design', vendor: 'Ant Group', stack: 'antd', status: 'planned', note: 'React kit for the web port.', port: 'web' },
  { id: 'pyqt', name: 'Qt Widgets', vendor: 'Qt', stack: 'PyQt6.QtWidgets', status: 'placeholder', note: 'Python/PyQt6 port kit.', port: 'python' },
];

export function Libraries() {
  const [tab, setTab] = useState<'framework' | 'ui'>('framework');
  return (
    <div className="fx-stack fx-stack--lg">
      <div className="fx-row"><button className={`fx-chip ${tab === 'framework' ? 'is-selected' : ''}`} onClick={() => setTab('framework')}>Framework libraries</button><button className={`fx-chip ${tab === 'ui' ? 'is-selected' : ''}`} onClick={() => setTab('ui')}>UI libraries</button></div>
      {tab === 'framework' ? <FrameworkLibraries /> : <UiLibraries />}
    </div>
  );
}

function FrameworkLibraries() {
  const rt = useRuntime();
  const s = useStore();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">{LIBRARIES.length} libraries · {s.libraries.length} installable · project: {s.project || 'none'}</p><h1>Libraries</h1><p className="fx-muted">Each library bundles catalog features. Build one (module + demo app), or Install one into the open project: the wizard asks for the library's parameters (its library.json) and writes manifest, gradle, App.kt and typed setup code.</p></div>
        <div className="fx-row fx-row--wrap"><Button icon="folder" onClick={() => rt.openDialog('project')}>{s.project || 'Open project'}</Button><Button icon="terminal" onClick={() => rt.dispatch('terminal.open:install')}>Terminal</Button></div>
      </header>
      <div className="fx-grid">
        {LIBRARIES.map((lib) => {
          const built = lib.features.filter((f) => s.status(f) === 'built').length; const sel = lib.features.filter((f) => s.isChecked(f)).length;
          const installable = s.libraries.find((l) => l.module === lib.packageName || l.id === lib.module);
          return (
            <Container key={lib.id} title={lib.label} icon="box" actions={<Chip tone={built === lib.features.length ? 'success' : built > 0 ? 'warning' : undefined}>{built}/{lib.features.length} built</Chip>}>
              <p className="fx-muted" style={{ marginTop: 0 }}>{lib.description}</p>
              <p className="fx-mono fx-small fx-muted">{lib.packageName} · {lib.module} · {sel} checked</p>
              <div className="fx-row fx-row--wrap">
                <Button tone="primary" icon="zap" onClick={() => rt.openDialog('libpicker', { library: lib.id })}>Build library</Button>
                {installable && <Button icon="download" requires="dev.tools" onClick={() => rt.openDialog('install', { library: installable.id })}>Install</Button>}
                <Button icon="layers" onClick={() => rt.navigate('catalog')}>Features</Button>
              </div>
            </Container>
          );
        })}
      </div>
      {s.ports.length > 0 && <Container title="Installs & imports" icon="download" actions={<Chip>{s.ports.length}</Chip>}>
        <table className="fx-table"><tbody>{[...s.ports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => <tr key={p.id}><th>{p.name}</th><td className="fx-muted fx-small">{p.kind} · {p.source}{p.project ? ` → ${p.project}` : ''} · {p.createdAt.slice(0, 16).replace('T', ' ')}</td><td><Chip tone={p.status === 'installed' || p.status === 'ported' ? 'success' : 'warning'}>{p.status}</Chip></td></tr>)}</tbody></table>
      </Container>}
    </div>
  );
}

/**
 * The nested "UI libraries" tab: left pane = kits that hot-swap into AXF apps, right pane = third-party / existing
 * libraries. Multi-select from either; Compare opens every selection as a tab in one floating tab group (undockable,
 * splittable, drag-and-drop). Import ports a third-party library to a new AmberX UI library through the wizard.
 */
function UiLibraries() {
  const rt = useRuntime();
  const wm = useWindowManager();
  const s = useStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ported = s.modules.filter((m) => m.kind === 'kit').map<UiLibrary>((m) => ({ id: `kit:${m.name}`, name: m.description || m.name, vendor: 'ported', stack: m.name, status: 'ready', note: 'Ported by the import wizard.', kitId: m.name.replace(/^kit-/, ''), port: 'android' }));
  const hot = [...UI_LIBRARIES.filter((l) => l.kitId), ...ported];
  const third = UI_LIBRARIES.filter((l) => !l.kitId);
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const compare = () => {
    const all = [...hot, ...third];
    const tabs = [...selected].map((id) => all.find((l) => l.id === id)).filter((l): l is UiLibrary => !!l).map((l) => ({ id: `cmp-${l.id}-${Date.now().toString(36)}`, title: l.name, kind: l.kitId ? 'kit-preview' : 'library-info', payload: l.kitId ?? l.id, icon: l.kitId ? 'grid' : 'box' }));
    if (!tabs.length) { rt.toast('Select at least one library to compare.', 'warning'); return; }
    wm.openFloating(tabs, `Compare: ${tabs.length} libraries`, 'floating', 520, 560);
    rt.terminal.log('compare', `opened ${tabs.length} libraries in a floating tab group`);
  };
  const pane = (title: string, libs: UiLibrary[], third: boolean) => (
    <Container title={title} icon="grid" actions={<Chip>{libs.filter((l) => selected.has(l.id)).length}/{libs.length}</Chip>}>
      <ul className="cx-list">{libs.map((l) => (
        <li key={l.id} className="cx-item">
          <label className="cx-check"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></label>
          <div className="fx-grow"><div>{l.name} <span className="fx-badge">{l.port}</span></div><div className="fx-muted fx-small">{l.vendor} · <span className="fx-mono">{l.stack}</span> · {l.note}</div></div>
          <Chip tone={l.status === 'active' ? 'success' : l.status === 'ready' || l.status === 'adapter' ? 'accent' : l.status === 'planned' ? 'warning' : undefined}>{l.status}</Chip>
          {third && <Button icon="download" requires="dev.tools" onClick={() => rt.openDialog('uiimport', { source: l.id })}>Import</Button>}
          {!third && l.port === 'android' && l.status !== 'active' && <Button icon="zap" onClick={() => rt.toast(`Swap the ui-kit asset to "${l.kitId}" in an Android app (Settings → Appearance) or set defaults.ui-kit in its manifest.`, 'info', 'Hot-swappable kit')}>Swap</Button>}
        </li>))}</ul>
    </Container>
  );
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">{selected.size} selected · {hot.length} kits · {third.length} third-party</p><h1>UI libraries</h1><p className="fx-muted">Left: kits that hot-swap into any AXF app. Right: third-party / existing libraries. Select from either pane and compare them side by side in floating tabs, or Import one: the wizard clones it, refactors it to AmberX tokens, saves it as a hot-swappable kit and applies it to the open project. Kinds a kit can't render fall back to the default AmberX kit — see the output terminal.</p></div>
        <div className="fx-row fx-row--wrap"><Button tone="primary" icon="layers" disabled={!selected.size} onClick={compare}>Compare</Button><Button icon="x" onClick={() => setSelected(new Set())}>Clear</Button><Button icon="terminal" onClick={() => rt.dispatch('terminal.open:hot-swap')}>Terminal</Button></div>
      </header>
      <div className="fx-grid cx-panes">{pane('Hot-swappable (AXF kits)', hot, false)}{pane('Third-party / existing', third, true)}</div>
      <Container title="Docked comparisons" icon="layout"><div style={{ height: 360 }}><DockArea empty={<div className="fx-empty">Nothing docked — redock a floating comparison window and its tab groups land here.</div>} /></div></Container>
    </div>
  );
}
