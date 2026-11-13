/**
 * GitHub client console plugin (ai.amberx.axf.console.github-client; DESIGN.md, contract.json).
 *
 * One page, Builds → GitHub client: a repo picker for the current project and six tabs — Pull requests, Batches,
 * Branches, Commits, Checks, Git log. Everything shown is a read and everything offered is a command on the plugin's
 * server part, so plugin-commands@1 puts each on REST, MCP, the CLI and voice. Deep links: console_show / console_open
 * `github-client` with a focus ("pr 123", "prs ready", "branch x", "commit <sha>", "checks <ref>", "log <q>",
 * "batch <id>") run the `github-client.focus` action this file registers.
 */
import { useEffect, useState } from 'react';
import { Chip, Note, SelectField, TabGroup } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './github-client.css';
import { appMenu } from './menu';
import { api, FOLDER, ID, parseFocus, setFocus, setSelected, TABS, useFocus, VIEW, type Filter, type Repo, type Tab } from './core';
import { PrsTab } from './prs';
import { BatchDialog, BatchesTab } from './batches';
import { BulkDialog } from './bulk';
import { BranchesTab, ChecksTab, CommitDialog, CommitsTab, DiffDialog } from './browse';
import { LogTab } from './log';
import { GitHubClientSettings } from './settings';

const TAB_LABEL: Record<Tab, string> = { prs: 'Pull requests', batches: 'Batches', branches: 'Branches', commits: 'Commits', checks: 'Checks', log: 'Git log' };
const TAB_ICON: Record<Tab, string> = { prs: 'github', batches: 'layers', branches: 'branch', commits: 'list', checks: 'check-circle', log: 'clock' };

interface Status { token: string; rate: { remaining?: number }; lastError: string; queue: { on: boolean; repo: string; depth: number }; jobs: { running: number; lastFailed: string }; lastFailure: { kind: string; why: string; at: string } | null; version: number }

function GitHubClientPage() {
  const focus = useFocus();
  const [tab, setTab] = useState<Tab>('prs');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openPr, setOpenPr] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [version, setVersion] = useState(0);
  const [err, setErr] = useState('');
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => { api.call<{ items: Repo[] }>('repos').then((r) => { setRepos(r.items); setRepo((cur) => cur || r.items[0]?.repo || ''); }, (e: Error) => setErr(e.message)); }, []);
  // Status is cheap (no GitHub call): every 15 s; a new version (a job finished, a command ran) reloads the open tab.
  useEffect(() => {
    let last = -1;
    const tick = () => { if (document.visibilityState !== 'visible') return; api.call<Status>('status').then((s) => { setStatus(s); if (last >= 0 && s.version !== last) reload(); last = s.version; }, () => {}); };
    tick();
    const t = setInterval(tick, 15_000);
    const slow = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 120_000);
    return () => { clearInterval(t); clearInterval(slow); };
  }, []);
  useEffect(() => {
    if (!focus) return;
    setTab(focus.tab);
    if (focus.repo) setRepo(focus.repo);
    if (focus.filter) setFilter(focus.filter);
    if (focus.pr) { setFilter('all'); setOpenPr(focus.pr); }
  }, [focus]);

  return (
    <div className="fx-stack fx-stack--lg axp-github-client" data-help="view:github-client">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Builds</p><h1>GitHub client</h1></div>
        <div className="axp-github-client__head" role="toolbar" aria-label="Repository">
          <SelectField label="Repository" value={repo} options={repos.map((r) => ({ value: r.repo, label: `${r.repo}${r.source === 'extra' ? ' (extra)' : ''}` }))} onChange={(v) => { setRepo(v); setSelected([]); setOpenPr(null); }} />
          {status && <span className="axp-github-client__status">
            <Chip tone={status.token === 'set' ? 'success' : 'danger'}>{status.token === 'set' ? 'token ok' : 'no token'}</Chip>
            {typeof status.rate?.remaining === 'number' && <Chip tone={status.rate.remaining < 300 ? 'warning' : undefined}>{status.rate.remaining} calls left</Chip>}
            <Chip tone={status.queue.on ? 'accent' : undefined}>{status.queue.on ? `merge queue on · ${status.queue.depth}` : 'merge queue off'}</Chip>
            {status.jobs.running > 0 && <Chip tone="warning">{status.jobs.running} job{status.jobs.running > 1 ? 's' : ''} running</Chip>}
          </span>}
        </div>
      </header>
      {err && <Note tone="danger">{err}</Note>}
      {status?.token === 'missing' && <Note tone="warning">GITHUB_TOKEN isn’t set on the console server: the GitHub App keeper sets it (Settings → Plugins → GitHub App).</Note>}
      {status?.lastFailure && <Note tone="danger">Last failure: {status.lastFailure.kind} — {status.lastFailure.why || 'see the Git log'}.</Note>}
      <TabGroup id="github-client.tabs" label="GitHub client" value={tab} onChange={(t) => setTab(t)} tabs={TABS.map((t) => ({ value: t, label: TAB_LABEL[t], icon: TAB_ICON[t] }))} />
      {repo && tab === 'prs' && <PrsTab repo={repo} filter={filter} setFilter={setFilter} open={openPr} setOpen={setOpenPr} version={version} reload={reload} />}
      {repo && tab === 'batches' && <BatchesTab repo={repo} version={version} reload={reload} focusId={focus?.tab === 'batches' ? focus.group : undefined} />}
      {repo && tab === 'branches' && <BranchesTab repo={repo} version={version} reload={reload} focusName={focus?.tab === 'branches' ? focus.branch : undefined} />}
      {repo && tab === 'commits' && <CommitsTab repo={repo} branch={focus?.tab === 'commits' ? focus.branch : undefined} sha={focus?.tab === 'commits' ? focus.sha : undefined} />}
      {repo && tab === 'checks' && <ChecksTab repo={repo} initial={focus?.tab === 'checks' ? focus.ref : undefined} />}
      {tab === 'log' && <LogTab repo={repo} version={version} reload={reload} initial={focus?.tab === 'log' ? focus.q : undefined} />}
    </div>
  );
}

function SettingsPanel() { return <GitHubClientSettings />; }

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'GitHub client',
  version: '0.1.0',
  appMenu,
  register(rt) {
    // Deep links: console_show / console_open "github-client" with focus "pr 123", "prs ready", "log x"… (console-commands@1)
    rt.actions.register('github-client.focus', ([f = '']) => { const p = parseFocus(f); if (p) setFocus(p); rt.navigate(VIEW); if (p?.tab === 'commits' && p.sha) rt.openDialog('github-client.commit', { sha: p.sha }); }, { label: 'Open the GitHub client on a PR, filter, branch, commit, check or log search', params: true } as never);
    rt.actions.register('github-client.batch', ([prs = '']) => { rt.navigate(VIEW); rt.openDialog('github-client.batch', { prs: prs.split(/[,\s]+/).map(Number).filter((n) => n > 0) }); }, { label: 'Batch merge: pull main into several PRs and land them as one', params: true } as never);
    rt.actions.register('github-client.refresh', () => { void api.post('refresh', {}).then(() => rt.toast('Refreshed from GitHub', 'success', 'GitHub client'), (e: Error) => rt.toast(e.message, 'danger', 'GitHub client')); }, { label: 'Refresh the GitHub client from GitHub' });
  },
  views: { [VIEW]: { title: 'GitHub client', icon: 'github', keywords: ['github', 'pull requests', 'prs', 'merge', 'pull main in', 'update from main', 'rebase', 'batch', 'group', 'bulk', 'branches', 'commits', 'checks', 'git log', 'restore branch'], render: () => <GitHubClientPage /> } },
  nav: { label: 'Builds', items: [{ id: 'github-client', label: 'GitHub client', icon: 'github', view: VIEW }] },
  dialogs: {
    'github-client.batch': { title: 'Batch merge', icon: 'layers', render: (p, close) => <BatchDialog repo={String(p.repo ?? '')} prs={(p.prs as number[]) ?? []} close={close} /> },
    'github-client.bulk': { title: 'Bulk actions', icon: 'list', render: (p, close) => <BulkDialog repo={String(p.repo ?? '')} prs={(p.prs as number[]) ?? []} close={close} /> },
    'github-client.commit': { title: 'Commit', icon: 'code', searchable: false, render: (p) => <CommitDialog repo={String(p.repo ?? '')} sha={String(p.sha ?? '')} /> },
    'github-client.diff': { title: 'Changes', icon: 'code', searchable: false, render: (p) => <DiffDialog repo={String(p.repo ?? '')} pr={Number(p.pr ?? 0)} base={String(p.base ?? '')} head={String(p.head ?? '')} /> },
  },
  settingsTabs: [{ id: FOLDER, label: 'GitHub client', icon: 'github', parent: 'plugins', order: 46, description: 'Repos, polling, stale days, merge method, readiness policy, batch retries and conflict help.' }],
  settingsPanels: [
    { id: 'github-client.settings', tab: FOLDER, title: 'GitHub client', icon: 'github', order: 10, render: () => <SettingsPanel /> },
    { id: 'github-client.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
