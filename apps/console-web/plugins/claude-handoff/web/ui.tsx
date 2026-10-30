import { useEffect, useState } from 'react';
import { Button, Chip, Container, Icon, Markdown, Note, SelectField, Switch, TextField, useRuntime, BannerIcon } from '@console/axf/react';
import { InstallerDialog } from './installer';
import { MoreMenu } from './more';
import {
  type ClaudeAi, type ClaudeItem, type Config, ago, api, dismissReminder, handoffSession, publish, refresh, set, until, useStore,
} from './store';

const KINDS = ['project', 'artifact', 'connector', 'memory', 'style', 'other'].map((k) => ({ value: k, label: k }));
const COLLECT = 'node apps/console-web/plugins/claude-handoff/handoff.mjs collect';
const HOOK = 'node apps/console-web/plugins/claude-handoff/handoff.mjs hooks install';

function copy(rt: ReturnType<typeof useRuntime>, text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(() => rt.toast(`${what} copied`, 'success'), () => undefined);
}

/* ---------------- banner (the 6-hourly reminder) ---------------- */

export function HandoffBanner() {
  const s = useStore();
  const rt = useRuntime();
  const r = s.status?.reminder;
  if (!r?.open || s.bannerHidden) return null;
  return (
    <div className="axp-claude-handoff-banner" role="status" aria-live="polite">
      <BannerIcon className="axp-claude-handoff-banner__icon" icon="rocket" working={!!s.busy} />
      <button type="button" data-fx-row className="axp-claude-handoff-banner__main" onClick={() => rt.navigate('claude-handoff')}>
        <strong>Refresh the Claude handoff kit</strong>
        <span className="axp-claude-handoff-banner__lead">{r.reason || `Due every ${r.everyHours} hours.`}</span>
      </button>
      <div className="axp-claude-handoff-banner__acts">
        {s.status?.canPublish && <Button tone="primary" icon="upload" disabled={!!s.busy} onClick={() => void publish()}>{s.busy === 'publish' ? 'Publishing…' : 'Publish now'}</Button>}
        <Button tone="ghost" icon="list" onClick={() => rt.navigate('claude-handoff')}>Open</Button>
        <button type="button" className="fx-iconbtn" aria-label="Dismiss until the next reminder" title={`Dismiss (it comes back in ${r.everyHours} h if the kit isn't refreshed)`} onClick={() => void dismissReminder()}><Icon name="x" size={16} /></button>
      </div>
    </div>
  );
}

/* ---------------- the Tools → Claude handoff page ---------------- */

export function HandoffView() {
  const s = useStore();
  const rt = useRuntime();
  useEffect(() => { void refresh(); }, []);
  const st = s.status;
  return (
    <div className="fx-stack axp-claude-handoff">
      <header className="fx-pagehead axp-claude-handoff__head">
        <div><p className="fx-eyebrow">Tools</p><h1>Claude handoff</h1><p className="fx-muted axp-claude-handoff__lede" title="Everything a new Claude account needs to carry this project on, kept current.">What a new Claude account needs to carry on, kept current.</p></div>
        <div className="axp-claude-handoff__row axp-claude-handoff__acts">
          <Button tone="primary" icon="rocket" disabled={!!s.busy} title="Opens the installer: publishes the kit when out of date, walks every file group, then hands you the prompt" onClick={() => rt.openDialog('claude-handoff.installer')}>Assemble prompt</Button>
          <MoreMenu label="More handoff actions" items={[
            !!s.assembled && { label: 'Copy the prompt again', icon: 'copy', onPick: () => copy(rt, s.assembled!.prompt, 'Prompt') },
            !!s.assembled?.results?.url && { label: 'Continue handoff on axHub', icon: 'external', onPick: () => window.open(s.assembled!.results!.url, '_blank', 'noopener,noreferrer') },
            { label: 'Last assembly results', icon: 'clock', disabled: !st?.state.lastAssembledAt, title: "The installer's results page from the last run: groups, steps, log, prompt, what was published", onPick: () => rt.openDialog('claude-handoff.last') },
            { label: 'Publish the kit', icon: 'upload', disabled: !!s.busy || !st?.canPublish, onPick: () => void publish() },
            { label: 'Installer preview', icon: 'play', onPick: () => rt.navigate('claude-handoff-preview') },
            { label: 'Handoff files…', icon: 'file', onPick: () => rt.dispatch('claude-handoff.files') },
          ]} />
        </div>
      </header>
      <details className="axp-claude-handoff__about">
        <summary className="axp-claude-handoff__meta">About this page{st?.state.lastAssembledAt ? ` · last assembled ${ago(st.state.lastAssembledAt)}` : ''}</summary>
        <p className="axp-claude-handoff__meta">One prompt that moves this project to a new Claude account: it keeps working on the same repo and sets up the claude.ai Project, instructions, memory and user files from the handoff kit in <code>_claude/handoff/</code>, which this page keeps current. <b>Assemble prompt</b> opens the installer: it publishes the kit when it is out of date, walks every file group by group, then hands you the prompt. Paste it into a new session on the new account (claude.ai/code works in the same repo, MossesX/AmberX-AXF: no new repo, no fork).</p>
      </details>
      {s.assembled?.note && <Note tone="warning">{s.assembled.note}</Note>}
      {s.assembled && <details className="axp-claude-handoff__item" open><summary>The handoff prompt</summary><TextField label="The handoff prompt" value={s.assembled.prompt} onChange={() => undefined} rows={10} mono /></details>}

      <HandoffSession />

      {s.error && <Note tone="danger">{s.error}</Note>}
      {st && <KitStatus />}
      <ClaudeAiItems />
      <Machines />
      <Preview />
    </div>
  );
}

/** Handoff Session: for a Project that already exists on the other account (the prompt above is for a new one). */
function HandoffSession() {
  const s = useStore();
  const rt = useRuntime();
  const [notes, setNotes] = useState<string | null>(null);
  const [threads, setThreads] = useState('');
  const [last, setLast] = useState<{ markdown: string; savedAt: string } | null>(null);
  useEffect(() => {
    api.call<{ notes: string | null; threads?: string; savedAt: string; markdown: string }>('session').then((r) => { setNotes(r.notes); setThreads(r.threads ?? ''); setLast(r); }, () => undefined);
  }, []);
  const out = s.session;
  const counts = out?.counts;
  return (
    <Container title="Handoff Session" icon="list">
      <div className="fx-stack">
        <div className="axp-claude-handoff__row">
          <Button tone="primary" icon="list" disabled={!!s.busy} onClick={() => void handoffSession(notes, true, threads)}>{s.busy === 'session' ? 'Summarising…' : 'Handoff Session'}</Button>
          {out && <Button icon="copy" onClick={() => copy(rt, out.prompt, 'Session summary')}>Copy again</Button>}
        </div>
        <details className="axp-claude-handoff__about"><summary className="axp-claude-handoff__meta">For a Project that already exists on the other account: open work, rules and notes, copied to paste there.</summary>
        <p className="axp-claude-handoff__meta">When the Project already exists on the other account: summarises everything still open here (unfinished Codebase changes entries, pending builds, open pull requests) with the standing rules and the notes below, copies it to paste into that Project, and keeps it in the kit as <code>_claude/handoff/ACTIVE-THREADS.md</code> (published when this console can). The copied prompt also has a <b>Threads to recreate</b> part: one ready first message per open thread (each unfinished change, each open PR, and each line of the open-threads list below), and it tells the other account to start one thread per entry. claude.ai threads can't be read from here, so list the ones only a thread knows below.</p></details>
        {!out && last?.savedAt && <p className="axp-claude-handoff__meta">Last summary made {ago(last.savedAt)}.</p>}
        {counts && <div className="axp-claude-handoff__row">
          <Chip tone={counts.changes ? 'warning' : 'success'}>{counts.changes} in progress</Chip>
          <Chip>{counts.pending} pending builds</Chip>
          <Chip>{counts.prs === null ? 'PRs not read' : `${counts.prs} open PRs`}</Chip>
          {counts.threads !== undefined && <Chip tone="accent">{counts.threads} threads to recreate</Chip>}
          {out?.published?.pushed && <Chip tone="success">kit published {out.published.sha}</Chip>}
        </div>}
        {out?.note && <Note tone="warning">{out.note}</Note>}
        <details className="axp-claude-handoff__item">
          <summary>Open threads to recreate on the other account</summary>
          <TextField label="Open threads" hint="One thread per line: Title: where it stood / what it waits on. Each becomes a thread to start, with its first message. Unfinished changes and open PRs are added by themselves." value={threads} placeholder="Voice notes: PR #51 ready, mic switch waits on a model pick" onChange={(v) => setThreads(v)} rows={4} />
        </details>
        <details className="axp-claude-handoff__item">
          <summary>Notes for the other account (known gaps, what open threads were waiting on)</summary>
          <TextField label="Notes" hint="One per line; added under Known gaps and notes. Secrets are redacted, but don't put any here." value={notes ?? ''} placeholder="Empty = the default notes" onChange={(v) => setNotes(v)} rows={4} />
          <Button tone="ghost" icon="refresh" onClick={() => setNotes(null)}>Back to the default notes</Button>
        </details>
        {out && <div className="axp-claude-handoff__doc"><Markdown text={out.markdown.replace(/^<!--.*-->\n/, '')} /></div>}
      </div>
    </Container>
  );
}

function KitStatus() {
  const s = useStore();
  const st = s.status!;
  const [open, setOpen] = useState(false);
  const ch = st.changes;
  return (
    <Container title="Handoff kit" icon="package" actions={<Button tone="ghost" icon="refresh" disabled={!!s.busy} onClick={() => void refresh()}>Check</Button>}>
      <div className="fx-stack">
        <div className="axp-claude-handoff__row">
          {st.kit ? <Chip tone={st.current ? 'success' : 'warning'}>{st.current ? 'Current' : 'Out of date'}</Chip> : <Chip tone="danger">Not published</Chip>}
          <span className="axp-claude-handoff__meta">{st.kit ? `Built ${ago(st.kit.generatedAt)} at ${st.kit.commit.slice(0, 7)} · ${st.kit.files} files` : 'No kit in _claude/handoff yet'}</span>
          <span className="axp-claude-handoff__meta">{st.sources} source files · {st.machines.length} machine{st.machines.length === 1 ? '' : 's'} · {st.claudeAi.items} claude.ai items</span>
        </div>
        {ch.count > 0 && (
          <div>
            <Button tone="ghost" icon={open ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen(!open)}>{ch.count} repo file{ch.count === 1 ? '' : 's'} changed since the kit</Button>
            {open && (
              <ul className="axp-claude-handoff__list">
                {ch.changed.map((p) => <li key={p}><Chip>changed</Chip> <code>{p}</code></li>)}
                {ch.added.map((p) => <li key={p}><Chip tone="accent">new</Chip> <code>{p}</code></li>)}
                {ch.removed.map((p) => <li key={p}><Chip tone="danger">gone</Chip> <code>{p}</code></li>)}
              </ul>
            )}
          </div>
        )}
        <div className="axp-claude-handoff__row">
          <Button tone="primary" icon="upload" disabled={!!s.busy || !st.canPublish} onClick={() => void publish()}>{s.busy === 'publish' ? 'Publishing…' : 'Publish to GitHub'}</Button>
          <span className="axp-claude-handoff__meta">Last published {ago(st.state.lastPublishedAt)}{st.state.lastPublishSha ? ` (${st.state.lastPublishSha})` : ''} · next reminder {st.reminder.open ? 'showing now' : until(st.reminder.dueAt)} (every {st.reminder.everyHours} h)</span>
        </div>
        {!st.canPublish && <Note tone="warning">This console has no GITHUB_TOKEN, so it can't publish the kit. Add one (Contents: write) in Systems check → Keys, or run <code>node apps/console-web/plugins/claude-handoff/handoff.mjs publish</code> where one is set.</Note>}
      </div>
    </Container>
  );
}

function ClaudeAiItems() {
  const rt = useRuntime();
  const [data, setData] = useState<ClaudeAi | null>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.call<ClaudeAi>('claude-ai').then(setData, (e: Error) => setErr(e.message)); }, []);
  if (!data) return err ? <Note tone="danger">{err}</Note> : null;
  const upd = (i: number, p: Partial<ClaudeItem>) => setData({ ...data, items: data.items.map((it, k) => (k === i ? { ...it, ...p } : it)) });
  const save = async () => {
    setSaving(true);
    try { setData(await api.put<ClaudeAi>('claude-ai', data)); setErr(''); rt.toast('claude.ai items saved; publish to put them in the kit', 'success'); void refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <Container title="claude.ai items" icon="cloud" actions={<Button tone="primary" icon="save" disabled={saving} onClick={() => void save()}>Save</Button>}>
      <div className="fx-stack">
        <p className="axp-claude-handoff__meta axp-claude-handoff__clip" title="Things only claude.ai knows (the Project, artifacts like the Pending Builds page, connectors, memory). A new account starts without them, so each one says how to recreate it.">Things only claude.ai knows, each with how to recreate it.</p>
        {err && <Note tone="danger">{err}</Note>}
        {data.items.map((it, i) => (
          <details key={i} className="axp-claude-handoff__item">
            <summary><Chip>{it.kind}</Chip> {it.name || it.id}</summary>
            <div className="axp-claude-handoff__grid">
              <TextField label="Id" value={it.id} onChange={(v) => upd(i, { id: v })} mono />
              <SelectField label="Kind" value={it.kind} options={KINDS} onChange={(v) => upd(i, { kind: v })} />
              <TextField label="Name" value={it.name} onChange={(v) => upd(i, { name: v })} />
              <TextField label="Link (https)" value={it.url} onChange={(v) => upd(i, { url: v })} mono />
              <TextField label="Notes" value={it.notes} onChange={(v) => upd(i, { notes: v })} rows={2} />
              <TextField label="How to recreate it" value={it.recreate} onChange={(v) => upd(i, { recreate: v })} rows={2} />
            </div>
            <Button tone="danger" icon="trash" onClick={() => setData({ ...data, items: data.items.filter((_, k) => k !== i) })}>Remove</Button>
          </details>
        ))}
        <div><Button icon="plus" onClick={() => setData({ ...data, items: [...data.items, { id: `item-${data.items.length + 1}`, kind: 'other', name: '', url: '', notes: '', recreate: '' }] })}>Add item</Button></div>
        <TextField label="claude.ai memory" hint="Paste the account's memory (claude.ai → Settings → Memory). Secrets are redacted in the kit." value={data.memory} onChange={(v) => setData({ ...data, memory: v })} rows={5} />
        <TextField label="Old Project instructions" hint="Optional: the current claude.ai Project's custom instructions, kept for reference. The new ones are generated." value={data.projectInstructions} onChange={(v) => setData({ ...data, projectInstructions: v })} rows={4} />
      </div>
    </Container>
  );
}

function Machines() {
  const s = useStore();
  const rt = useRuntime();
  const ms = s.status?.machines ?? [];
  const remove = async (host: string) => { try { await api.del(`machines/${encodeURIComponent(host)}`); } catch (e) { rt.toast((e as Error).message, 'danger'); } void refresh(); };
  return (
    <Container title="~/.claude on each machine" icon="monitor">
      <div className="fx-stack">
        <p className="axp-claude-handoff__meta axp-claude-handoff__clip" title="User-level Claude files (user CLAUDE.md, commands, skills, agents, settings hooks, auto-memory) live outside the repo. Each machine sends them here; the kit keeps redacted copies.">User-level Claude files each machine sends here (redacted in the kit).</p>
        {ms.length ? (
          <ul className="axp-claude-handoff__list">
            {ms.map((m) => (
              <li key={m.host} className="axp-claude-handoff__machine">
                <strong>{m.host}</strong>
                <span className="axp-claude-handoff__meta">{m.files} files · sent {ago(m.collectedAt)}</span>
                {!m.inKit && <Chip tone="warning">not in the kit yet</Chip>}
                <button type="button" className="fx-iconbtn" aria-label={`Forget ${m.host}`} title="Forget this machine's files" onClick={() => void remove(m.host)}><Icon name="trash" size={15} /></button>
              </li>
            ))}
          </ul>
        ) : <Note>No machine has sent its files yet.</Note>}
        <div className="axp-claude-handoff__row">
          <Button icon="copy" title="Run in AmberX-AXF's folder on each machine" onClick={() => copy(rt, HOOK, 'Hook command')}>Copy: install the hook</Button>
          <Button icon="copy" onClick={() => copy(rt, COLLECT, 'Command')}>Copy: send now</Button>
        </div>
        <p className="axp-claude-handoff__meta axp-claude-handoff__clip" title="Run in AmberX-AXF's folder on each machine (VPS, computers). The hook sends once an hour when a Claude Code session starts; it needs AXF_TOKEN to reach the console from outside it.">Run in AmberX-AXF's folder on each machine (VPS, computers); needs <code>AXF_TOKEN</code> from outside.</p>
      </div>
    </Container>
  );
}

function Preview() {
  const s = useStore();
  const [files, setFiles] = useState<{ path: string; bytes: number }[] | null>(null);
  const [pick, setPick] = useState<{ path: string; text: string } | null>(null);
  const [err, setErr] = useState('');
  const build = async () => {
    set({ busy: 'preview' });
    try { const r = await api.post<{ files: { path: string; bytes: number }[] }>('preview', {}); setFiles(r.files); setErr(''); }
    catch (e) { setErr((e as Error).message); }
    finally { set({ busy: '' }); }
  };
  const open = async (path: string) => { try { setPick(await api.call<{ path: string; text: string }>(`preview/file?path=${encodeURIComponent(path)}`)); } catch (e) { setErr((e as Error).message); } };
  const top = (files ?? []).filter((f) => !f.path.includes('/'));
  const nested = (files ?? []).length - top.length;
  return (
    <Container title="Preview the kit" icon="eye" actions={<Button tone="ghost" icon="refresh" disabled={!!s.busy} onClick={() => void build()}>{files ? 'Rebuild' : 'Build preview'}</Button>}>
      <div className="fx-stack">
        {err && <Note tone="danger">{err}</Note>}
        {!files && <p className="axp-claude-handoff__meta">Builds the kit here without publishing, to read what a new account will get.</p>}
        {files && (
          <div className="axp-claude-handoff__row">
            <SelectField label="File" value={pick?.path ?? ''} empty="Pick a file to read…" options={top.map((f) => ({ value: f.path, label: f.path }))} onChange={(v) => { if (v) void open(v); }} />
            {nested > 0 && <span className="axp-claude-handoff__meta">+ {nested} copies in context/, user/, sources/</span>}
          </div>
        )}
        {pick && (pick.path.endsWith('.md') ? <div className="axp-claude-handoff__doc"><Markdown text={pick.text} /></div> : <TextField label={pick.path} value={pick.text} onChange={() => undefined} rows={14} mono />)}
      </div>
    </Container>
  );
}

/* ---------------- Tools → Installer preview ---------------- */

export function PreviewView() {
  const rt = useRuntime();
  return (
    <div className="fx-stack axp-claude-handoff">
      <header className="fx-pagehead axp-claude-handoff__head">
        <div><p className="fx-eyebrow">Tools</p><h1>Installer preview</h1><p className="fx-muted axp-claude-handoff__lede" title="The Claude handoff installer running on this project's real files, with example machines. Nothing is published: the prompt at the end comes from a preview build. Change its layout, gauges, meters and themes with Look (also Tools → Installer look).">The installer on real files with example data; nothing is published.</p></div>
        <Button icon="palette" onClick={() => rt.openDialog('claude-handoff.look')}>Look</Button>
      </header>
      <div className="axp-claude-handoff__previewbox"><InstallerDialog demo /></div>
    </div>
  );
}

/* ---------------- settings tab ---------------- */

export function HandoffSettings() {
  const rt = useRuntime();
  const [c, setC] = useState<Config | null>(null);
  const [extra, setExtra] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api.call<Config>('config').then((x) => { setC(x); setExtra(x.context.join('\n')); }, (e: Error) => setErr(e.message)); }, []);
  if (!c) return err ? <Note tone="danger">{err}</Note> : null;
  const save = async (next: Config) => {
    try { const r = await api.put<Config>('config', next); setC(r); setErr(''); rt.toast('Saved', 'success'); void refresh(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="fx-stack">
      {err && <Note tone="danger">{err}</Note>}
      <TextField label="Remind every (hours)" type="number" value={String(c.remindHours)} onChange={(v) => setC({ ...c, remindHours: Math.max(1, Math.min(48, Number(v) || 6)) })} hint="One banner and one alert (same key, so a repeat overwrites it); cleared when you publish or dismiss." />
      <Switch label="Remind only when something changed" checked={c.onlyWhenChanged} onChange={(v) => setC({ ...c, onlyWhenChanged: v })} />
      <Switch label="Publish by itself when the reminder is due" hint="Pushes _claude/handoff to GitHub instead of reminding, when the kit is out of date and GITHUB_TOKEN is set." checked={c.autoPublish} onChange={(v) => setC({ ...c, autoPublish: v })} />
      <Switch label="Include this console's own ~/.claude" checked={c.collectConsole} onChange={(v) => setC({ ...c, collectConsole: v })} />
      <TextField label="More files for claude.ai Project knowledge" hint="Repo paths, one per line, added to the standard set copied into context/." value={extra} onChange={setExtra} rows={4} mono />
      <div><Button tone="primary" icon="save" onClick={() => void save({ ...c, context: extra.split('\n').map((x) => x.trim()).filter(Boolean) })}>Save</Button></div>
    </div>
  );
}
