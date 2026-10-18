/** One plugin, everything about it: overview, dependencies in detail, its UI and settings, logs, files, install. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { hasSettings, hasUi, openSettings, openUi, setEnabled } from './actions';
import {
  DEP_LABEL, DEP_TONE, fmtBytes, HEALTH_LABEL, HEALTH_TONE, loadFiles, loadLogs, monogram,
  type Conflict, type Dependency, type Inventory, type LogLine, type PluginRow,
} from './model';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'info' },
  { id: 'deps', label: 'Dependencies', icon: 'branch' },
  { id: 'ui', label: 'UI & settings', icon: 'settings' },
  { id: 'logs', label: 'Logs', icon: 'terminal' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'install', label: 'Install', icon: 'package' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function Monogram({ row, size = 'md' }: { row: PluginRow; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`axp-plugin-manager-mono axp-plugin-manager-mono--${size} is-${row.health}`} aria-hidden>{monogram(row.name)}</span>;
}

export function HealthChip({ row }: { row: PluginRow }) {
  return <Chip tone={HEALTH_TONE[row.health]}>{HEALTH_LABEL[row.health]}</Chip>;
}

export function QuickActions({ row, onChanged, compact }: { row: PluginRow; onChanged: () => void; compact?: boolean }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const toggle = async () => { setBusy(true); if (await setEnabled(rt, row, !row.enabled)) onChanged(); setBusy(false); };
  return (
    <div className="axp-plugin-manager-actions fx-row fx-row--wrap">
      <Button tone={row.enabled ? 'neutral' : 'primary'} icon={row.enabled ? 'pause' : 'play'} disabled={busy || row.removed} onClick={() => void toggle()}>
        {compact ? null : row.enabled ? 'Disable' : 'Enable'}
      </Button>
      {hasUi(row) && <Button tone="ghost" icon="external" disabled={!row.enabled} onClick={() => openUi(rt, row)}>{compact ? null : 'Open'}</Button>}
      {hasSettings(row) && <Button tone="ghost" icon="settings" disabled={!row.enabled} onClick={() => openSettings(rt, row)}>{compact ? null : 'Settings'}</Button>}
    </div>
  );
}

export function DetailPane({ row, inv, onChanged, onSelect, initialTab }: { row: PluginRow; inv: Inventory; onChanged: () => void; onSelect: (folder: string) => void; initialTab?: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab ?? 'overview');
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab, row.folder]);
  const conflicts = inv.conflicts.filter((c) => c.folders.includes(row.folder));
  return (
    <article className="axp-plugin-manager-detail">
      <header className="axp-plugin-manager-detail__head">
        <Monogram row={row} size="lg" />
        <div className="axp-plugin-manager-detail__title">
          <h2>{row.name} <span className="fx-muted fx-small">{row.version}</span></h2>
          <p className="fx-mono fx-small fx-muted">{row.id} · plugins/{row.folder}</p>
          <div className="fx-row fx-row--wrap">
            <HealthChip row={row} />
            <Chip tone={row.enabled ? 'success' : undefined}>{row.enabled ? 'enabled' : 'disabled'}</Chip>
            {row.server === 'loaded' && <Chip tone="accent">server part</Chip>}
            {row.server === 'error' && <Chip tone="danger">server failed</Chip>}
            {row.uiEditor.length > 0 && <Chip tone="accent">UI editor: {row.uiEditor.join(', ')}</Chip>}
            {row.builtWith?.model && <Chip>built on {row.builtWith.model}</Chip>}
            {conflicts.length > 0 && <Chip tone="warning">{conflicts.length} clash{conflicts.length > 1 ? 'es' : ''}</Chip>}
          </div>
        </div>
        <QuickActions row={row} onChanged={onChanged} />
      </header>
      <div className="axp-plugin-manager-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`axp-plugin-manager-tabs__tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={14} /> {t.label}
            {t.id === 'deps' && row.dependencies.some((d) => d.required && (d.status === 'missing' || d.status === 'disabled')) && <span className="axp-plugin-manager-dot is-error" />}
            {t.id === 'logs' && row.logCount > 0 && <span className="axp-plugin-manager-count">{row.logCount}</span>}
          </button>
        ))}
      </div>
      <div className="axp-plugin-manager-detail__body">
        {tab === 'overview' && <Overview row={row} conflicts={conflicts} />}
        {tab === 'deps' && <Dependencies row={row} conflicts={conflicts} onSelect={onSelect} />}
        {tab === 'ui' && <UiAndSettings row={row} />}
        {tab === 'logs' && <Logs row={row} />}
        {tab === 'files' && <Files row={row} />}
        {tab === 'install' && <PluginLifecyclePanel folder={row.folder} />}
      </div>
    </article>
  );
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="axp-plugin-manager-facts">
      {items.map(([k, v]) => <div key={k} className="axp-plugin-manager-facts__row"><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

function Overview({ row, conflicts }: { row: PluginRow; conflicts: Conflict[] }) {
  const parts = Object.entries(row.parts).filter(([, v]) => v).map(([k]) => k);
  return (
    <div className="fx-stack">
      {row.description && <p className="axp-plugin-manager-desc">{row.description}</p>}
      {(row.error || row.webProblem) && <p className="axp-plugin-manager-error fx-mono fx-small">{row.error ?? row.webProblem}</p>}
      <Facts items={[
        ['Author', row.author || '—'],
        ['Kind', `${row.kind || '—'} · plugin@1 API ${row.apiLevel ?? '?'}`],
        ['Parts', parts.join(', ') || '—'],
        ['Code', `${row.code.files} files · ${fmtBytes(row.code.bytes)}`],
        ['Data', row.lifecycle.dataDir ? `${row.lifecycle.dataDir} · ${row.lifecycle.data.files} files · ${fmtBytes(row.lifecycle.data.bytes)}` : row.lifecycle.dataDirProblem ?? '—'],
        ['Lifecycle', row.lifecycle.managed ? `plugin-lifecycle@1${row.backups ? ` · ${row.backups} backup${row.backups > 1 ? 's' : ''}` : ''}` : 'older plugin (no lifecycle block)'],
        ['Services', row.services.length ? row.services.join(', ') : '—'],
        ['Provides', row.provides.length ? row.provides.join(', ') : '—'],
        ['Scopes', row.scopes.join(', ') || '—'],
        ['Last log', row.lastLog ? `${new Date(row.lastLog.at).toLocaleString()} · ${row.lastLog.text}` : '—'],
        ...(row.builtWith?.replacedBy ? [['Next build', row.builtWith.replacedBy] as [string, ReactNode]] : []),
      ]} />
      {conflicts.length > 0 && <ConflictList conflicts={conflicts} />}
    </div>
  );
}

export function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  return (
    <div className="fx-stack">
      <h3 className="axp-plugin-manager-h">Clashes</h3>
      {conflicts.map((c) => (
        <div key={c.id} className={`axp-plugin-manager-clash is-${c.severity}`}>
          <strong>{c.kind}</strong> <code>{c.key}</code> <span className="fx-muted">· {c.folders.join(', ')}</span>
          <p className="fx-small">{c.detail}</p>
        </div>
      ))}
      <p className="fx-muted fx-small">Read-only for now: the conflict alarm with uninstall / ignore / AI patch is pending item <code>plugin-conflicts</code> (parked as unsafe until it's designed).</p>
    </div>
  );
}

const KIND_LABEL: Record<Dependency['kind'], string> = { framework: 'Framework', service: 'Capability', env: 'Environment', scope: 'Scope', core: 'Console core', other: 'Other' };

function Dependencies({ row, conflicts, onSelect }: { row: PluginRow; conflicts: Conflict[]; onSelect: (folder: string) => void }) {
  const groups = useMemo(() => {
    const g = new Map<Dependency['kind'], Dependency[]>();
    for (const d of row.dependencies) g.set(d.kind, [...(g.get(d.kind) ?? []), d]);
    return [...g.entries()];
  }, [row]);
  const blocking = row.dependencies.filter((d) => d.required && (d.status === 'missing' || d.status === 'disabled' || d.status === 'unsupported'));
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>
        {blocking.length ? `${blocking.length} required dependenc${blocking.length > 1 ? 'ies are' : 'y is'} not met.` : 'Every required dependency is met.'}{' '}
        {row.dependents.length ? `${row.dependents.length} plugin${row.dependents.length > 1 ? 's' : ''} use${row.dependents.length > 1 ? '' : 's'} it.` : 'No other plugin uses it.'}
      </p>
      <h3 className="axp-plugin-manager-h">Needs</h3>
      {groups.map(([kind, deps]) => (
        <div key={kind} className="axp-plugin-manager-depgroup">
          <p className="axp-plugin-manager-depgroup__label">{KIND_LABEL[kind]}</p>
          {deps.map((d) => (
            <div key={`${d.kind}:${d.name}`} className={`axp-plugin-manager-dep is-${DEP_TONE(d.status) ?? 'neutral'}`}>
              <div className="axp-plugin-manager-dep__top">
                <code className="axp-plugin-manager-dep__name">{d.name}</code>
                <Chip>{d.required ? 'required' : 'optional'}</Chip>
                <Chip tone={DEP_TONE(d.status)}>{DEP_LABEL[d.status] ?? d.status}</Chip>
              </div>
              <p className="axp-plugin-manager-dep__detail">{d.detail}</p>
              {d.providers && d.providers.length > 0 && (
                <div className="fx-row fx-row--wrap">
                  <span className="fx-muted fx-small">Provided by</span>
                  {d.providers.map((p) => (
                    <button key={p.folder} type="button" className="axp-plugin-manager-link" onClick={() => onSelect(p.folder)}>
                      {p.name}{p.enabled ? '' : ' (off)'}{p.live === false ? ' · not registered yet' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      <h3 className="axp-plugin-manager-h">Needed by</h3>
      {row.dependents.length === 0 && <p className="fx-muted fx-small" style={{ margin: 0 }}>Nothing depends on it, so it can be switched off or removed without affecting other plugins.</p>}
      {row.dependents.map((d) => (
        <div key={`${d.folder}:${d.service}`} className="axp-plugin-manager-dep">
          <div className="axp-plugin-manager-dep__top">
            <button type="button" className="axp-plugin-manager-link" onClick={() => onSelect(d.folder)}>{d.name}</button>
            <Chip>{d.required ? 'requires' : 'optional'}</Chip>
            <code className="fx-small">{d.service}</code>
          </div>
          <p className="axp-plugin-manager-dep__detail">
            {d.required ? `Switching ${row.name} off or removing it stops ${d.name} from working.` : `Without ${row.name}, ${d.name} hides the features that use ${d.service}.`}
          </p>
        </div>
      ))}
      {conflicts.length > 0 && <ConflictList conflicts={conflicts} />}
    </div>
  );
}

function UiAndSettings({ row }: { row: PluginRow }) {
  const rt = useRuntime();
  const [inline, setInline] = useState<string>('');
  const panels = inline ? rt.settings.panelsIn(inline) : [];
  return (
    <div className="fx-stack">
      <h3 className="axp-plugin-manager-h">Its UI</h3>
      {!hasUi(row) && <p className="fx-muted fx-small" style={{ margin: 0 }}>No page or window of its own{row.ui.contextItems ? `; it adds ${row.ui.contextItems} context-menu item${row.ui.contextItems > 1 ? 's' : ''}` : ''}.</p>}
      {row.ui.views.map((v) => (
        <div key={v.id} className="axp-plugin-manager-entry">
          <Icon name={v.icon ?? 'layout'} size={16} /> <span className="fx-grow">{v.title} <span className="fx-muted fx-small">page · {v.id}</span></span>
          <Button tone="ghost" icon="external" disabled={!row.enabled} onClick={() => openUi(rt, row, v.id)}>Open</Button>
        </div>
      ))}
      {row.ui.dialogs.map((d) => (
        <div key={d.id} className="axp-plugin-manager-entry">
          <Icon name="monitor" size={16} /> <span className="fx-grow">{d.title} <span className="fx-muted fx-small">window · {d.id}</span></span>
          <Button tone="ghost" icon="external" disabled={!row.enabled} onClick={() => openUi(rt, row, d.id)}>Open</Button>
        </div>
      ))}
      <h3 className="axp-plugin-manager-h">Its settings</h3>
      {!hasSettings(row) && <p className="fx-muted fx-small" style={{ margin: 0 }}>No settings.</p>}
      {row.ui.settingsTabs.map((t) => (
        <div key={t.id} className="axp-plugin-manager-entry">
          <Icon name="settings" size={16} /> <span className="fx-grow">{t.label} <span className="fx-muted fx-small">Settings → Plugins → {t.label}</span></span>
          <Button tone="ghost" icon="eye" disabled={!row.enabled} onClick={() => setInline(inline === t.id ? '' : t.id)}>{inline === t.id ? 'Hide' : 'Show here'}</Button>
          <Button tone="ghost" icon="external" disabled={!row.enabled} onClick={() => openSettings(rt, row, t.id)}>Open</Button>
        </div>
      ))}
      {!row.enabled && (hasUi(row) || hasSettings(row)) && <p className="fx-muted fx-small" style={{ margin: 0 }}>It's off: enable it to open its UI and settings.</p>}
      {inline && (
        <div className="axp-plugin-manager-inline">
          {panels.length === 0 && <p className="fx-muted fx-small">This tab only has generated settings. Open it in Settings to edit them.</p>}
          {panels.map((p) => (
            <section key={p.id} className="axp-plugin-manager-inline__panel">
              <h4><Icon name={p.icon ?? 'settings'} size={14} /> {p.title}</h4>
              {p.render() as ReactNode}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Logs({ row }: { row: PluginRow }) {
  const [level, setLevel] = useState('');
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const load = () => { setLines(null); void loadLogs(row.folder, level).then(setLines); };
  useEffect(load, [row.folder, level]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <select className="fx-input axp-plugin-manager-select" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Log level">
          <option value="">All levels</option><option value="info">info</option><option value="ok">ok</option><option value="warn">warn</option><option value="error">error</option>
        </select>
        <Button tone="ghost" icon="refresh" onClick={load}>Refresh</Button>
      </div>
      {lines === null && <p className="fx-muted">Loading…</p>}
      {lines?.length === 0 && <p className="fx-muted fx-small">No console log lines from or about {row.name} yet.</p>}
      {lines && lines.length > 0 && (
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
    </div>
  );
}

function Files({ row }: { row: PluginRow }) {
  const [files, setFiles] = useState<{ path: string; bytes: number }[] | null>(null);
  useEffect(() => { setFiles(null); void loadFiles(row.folder).then(setFiles); }, [row.folder]);
  if (files === null) return <p className="fx-muted">Loading…</p>;
  if (!files.length) return <p className="fx-muted fx-small">No file list (the console API is offline).</p>;
  return (
    <ul className="axp-plugin-manager-files">
      {files.map((f) => <li key={f.path}><code>{f.path}</code><span className="fx-muted fx-small">{fmtBytes(f.bytes)}</span></li>)}
    </ul>
  );
}
