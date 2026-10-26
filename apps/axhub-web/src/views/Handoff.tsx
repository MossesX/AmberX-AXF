/**
 * Claude handoff results (decisions #91, #92; moved here from the hub's own pages by #96): every time the Dev Console
 * assembled the handoff prompt (last 10), and one run's installation page — the steps ticking off live while the new
 * account's Claude reports them, gauges, the session picker that copies the prompt (or a ready command) and opens
 * the session, "I've sent it", the prompt, how-to, the kit files and the installer's log.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Container, Gauge, Markdown, Meter, Note, TextField, useRuntime } from '../axf/react';
import { hubPost } from '../hub/api';
import { afterPick, clipboardFor, clock, handoffGauges, platformOf, relTime, sessionsFor, stepGroups, type HandoffStepView, type SessionType } from '../hub/core';
import { go, useRouteParams } from '../hub/route';
import { HUB } from '../hub/useHub';
import { CopyButton, HubGate, useHubJson, when } from './hubPage';

interface RunSummary { id: string; at: number; project: string; repo: string; commit: string; published: { pushed: boolean; sha: string } | null; failed: boolean; files: number }
interface Run {
  id: string; at: number; project: string; repo: string; commit: string; published: { pushed: boolean; sha: string } | null; failed: string | boolean; note: string;
  instructions: string; prompt: string; files: { path: string; bytes: number }[]; log: string[]; elapsed: number; rawUrl: string;
  steps: HandoffStepView[]; sentAt: number;
}

export function HandoffList() {
  return <HubGate admin what="handoff results">{() => <List />}</HubGate>;
}

function List() {
  const rt = useRuntime();
  const res = useHubJson<{ runs: RunSummary[] }>('/auth/api/handoff');
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Claude handoff</p>
          <h1>Handoff results</h1>
          <p className="fx-muted">Each time the Dev Console assembled the handoff prompt. Open one to carry the handoff on to the new account.</p>
        </div>
        <div className="fx-row"><Button icon="refresh" onClick={() => void res.reload()}>Check</Button></div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {res.data && res.data.runs.length === 0 && <Note>Nothing yet. Assemble the prompt in the Dev Console (Tools → Claude handoff).</Note>}
      {res.data?.runs.map((r) => (
        <Container key={r.id} title={when(r.at)} icon="package" actions={<Chip tone={r.failed ? 'danger' : r.published?.pushed ? 'success' : undefined}>{r.failed ? 'failed' : r.published?.pushed ? 'published' : 'not published'}</Chip>}>
          <div className="fx-stack">
            <p className="fx-muted">{r.project} · {r.repo}{r.commit ? ` · ${r.commit.slice(0, 7)}` : ''} · {r.files} files</p>
            <div className="fx-row"><Button size="sm" tone="primary" icon="chevron-right" onClick={() => go(rt, 'handoff-run', { id: r.id })}>Open</Button></div>
          </div>
        </Container>
      ))}
    </div>
  );
}

export function HandoffRun() {
  return <HubGate admin what="handoff results">{() => <RunPage />}</HubGate>;
}

function RunPage() {
  const rt = useRuntime();
  const params = useRouteParams('handoff-run');
  const id = params.id ?? '';
  const res = useHubJson<Run>(id ? `/auth/api/handoff/${encodeURIComponent(id)}` : null);
  const [live, setLive] = useState<{ steps: HandoffStepView[]; sentAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const run = res.data;
  const state = live ?? (run ? { steps: run.steps, sentAt: run.sentAt } : null);

  useEffect(() => { setLive(null); }, [id]);
  useEffect(() => {
    if (!id) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      try {
        const r = await fetch(`${HUB}/auth/api/handoff/${encodeURIComponent(id)}/progress`, { credentials: 'include', cache: 'no-store', redirect: 'error' });
        if (r.ok) setLive(await r.json());
      } catch { /* keep the last view */ }
    }, 2000);
    return () => clearInterval(t);
  }, [id]);

  const g = state ? handoffGauges(state.steps, state.sentAt, now) : null;

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Claude handoff</p>
          <h1>{run ? `Handoff · ${when(run.at)}` : 'Handoff'}</h1>
          {g && <p className="fx-muted">{g.status}</p>}
        </div>
        <div className="fx-row"><Button icon="arrow-left" onClick={() => go(rt, 'handoff')}>All runs</Button></div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {!run && !res.error && <p className="fx-muted">Reading the hub…</p>}
      {run && g && state && (
        <>
          {run.failed && <Note tone="danger">The assembly failed: {typeof run.failed === 'string' ? run.failed : 'see the log'}.</Note>}
          {run.note && <Note>{run.note}</Note>}
          <Container title="Progress" icon="chart">
            <div className="fx-stack">
              <Meter value={g.total ? (g.done / g.total) * 100 : 0} active={g.live} done={g.done >= g.total} label={`${g.done} of ${g.total} steps`} />
              <div className="fx-row fx-row--wrap">
                <Gauge label="Steps" value={g.done} max={Math.max(1, g.total)} integer />
                <Gauge label="Handoff" value={g.remaining ? (g.remDone / g.remaining) * 100 : 0} max={100} unit="%" integer />
                <Gauge label="Steps a minute" value={g.pace} max={3} />
                <Gauge label={g.left ? `About ${clock(g.left)} left` : 'Elapsed'} value={g.elapsed / 1000} max={Math.max(1, (g.elapsed + g.left) / 1000)} unit="s" integer />
              </div>
            </div>
          </Container>

          {!state.sentAt && <Continue run={run} onSent={setLive} />}

          {stepGroups(state.steps).map((grp) => (
            <Container key={grp.name} title={`${grp.name} · ${grp.done}/${grp.steps.length}`} icon={grp.done >= grp.steps.length ? 'check-circle' : 'list'} collapsible defaultOpen={grp.done < grp.steps.length}>
              <div className="fx-stack">
                <Meter small value={(grp.done / grp.steps.length) * 100} done={grp.done >= grp.steps.length} />
                <table className="fx-table">
                  <tbody>
                    {grp.steps.map((s) => (
                      <tr key={s.id}>
                        <th>{s.done ? '✓' : s.state === 'running' ? '…' : s.state === 'failed' ? '✗' : s.state === 'skipped' ? '–' : ''}</th>
                        <td>{s.label}{s.note ? <span className="fx-muted"> · {s.note}</span> : null}{s.at ? <span className="fx-muted"> · {relTime(s.at, now)}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Container>
          ))}

          <Container title="The prompt" icon="copy" collapsible defaultOpen={false} actions={<CopyButton text={run.prompt} />}>
            <pre className="fx-mono axp-axhub-call">{run.prompt}</pre>
          </Container>
          {run.instructions && (
            <Container title="How to use it" icon="help" collapsible defaultOpen={false}>
              <Markdown text={run.instructions} compact />
            </Container>
          )}
          <Files run={run} file={params.file} />
          <Container title="Published" icon="github" collapsible defaultOpen={false}>
            <p className="fx-muted">{run.repo}{run.commit ? ` at ${run.commit}` : ''} · {run.published ? (run.published.pushed ? `pushed ${run.published.sha.slice(0, 7)}` : 'unchanged, nothing pushed') : 'not published'}</p>
          </Container>
          {run.log.length > 0 && (
            <Container title={`Installer log · ${clock(run.elapsed)}`} icon="terminal" collapsible defaultOpen={false}>
              <pre className="fx-mono axp-axhub-call">{run.log.join('\n')}</pre>
            </Container>
          )}
        </>
      )}
    </div>
  );
}

function Continue({ run, onSent }: { run: Run; onSent: (s: { steps: HandoffStepView[]; sentAt: number }) => void }) {
  const rt = useRuntime();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [after, setAfter] = useState<{ s: SessionType; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const platform = platformOf(navigator.userAgent || '');

  const pick = async (s: SessionType) => {
    let copied = false;
    try { await navigator.clipboard.writeText(clipboardFor(s, run.prompt)); copied = true; } catch { copied = false; }
    let opened = false;
    if (s.kind === 'open' && s.url) { try { opened = !!window.open(s.url(run.prompt), '_blank', 'noopener'); } catch { opened = false; } }
    setAfter({ s, text: afterPick(s, copied, opened) });
  };

  const sent = async () => {
    setBusy(true);
    try { const r = await hubPost<{ steps: HandoffStepView[]; sentAt: number }>(`/auth/api/handoff/${encodeURIComponent(run.id)}/sent`); onSent(r); }
    catch (e) { rt.toast(`Couldn't mark it sent (${e instanceof Error ? e.message : String(e)}). Try again.`, 'danger'); }
    finally { setBusy(false); }
  };

  return (
    <Container title="Continue the handoff to the new account" icon="rocket">
      <div className="fx-stack">
        {!open ? (
          <div className="fx-row"><Button tone="primary" icon="rocket" onClick={() => setOpen(true)}>Continue installation and handoff</Button></div>
        ) : (
          <>
            <p className="fx-muted">Where will the new account's Claude run? This device's choices come first.</p>
            <TextField label="Find" type="search" value={q} onChange={setQ} />
            <div className="fx-stack">
              {sessionsFor(platform, q).map((s) => (
                <div key={s.id} className="fx-row fx-row--wrap">
                  <Button size="sm" onClick={() => void pick(s)}>{s.label}</Button>
                  <span className="fx-muted">{s.os && s.os === platform ? 'this device · ' : ''}{s.hint}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {after && (
          <Note tone="info" icon="info">
            <div className="fx-stack">
              <b>{after.s.label}</b>
              <span>{after.text}</span>
              <div className="fx-row"><Button tone="success" icon="check" disabled={busy} onClick={() => void sent()}>I've sent it</Button></div>
            </div>
          </Note>
        )}
      </div>
    </Container>
  );
}

function Files({ run, file }: { run: Run; file?: string }) {
  const rt = useRuntime();
  const shown = useHubJson<{ path: string; bytes: number; text: string }>(file ? `/auth/api/handoff/${encodeURIComponent(run.id)}/file?path=${encodeURIComponent(file)}` : null);
  const raw = (p: string) => `${HUB}${run.rawUrl}${encodeURIComponent(p)}`;
  return (
    <Container title={`Kit files · ${run.files.length}`} icon="folder" collapsible defaultOpen={!!file}>
      <div className="fx-stack">
        {file && (
          <Container title={file} icon="file" actions={<Button size="sm" tone="ghost" icon="x" onClick={() => go(rt, 'handoff-run', { id: run.id })}>Close</Button>}>
            {shown.error && <Note tone="danger">{shown.error}</Note>}
            {shown.data && (
              <div className="fx-stack">
                <div className="fx-row fx-row--wrap">
                  <CopyButton text={shown.data.text} />
                  <Button size="sm" icon="download" onClick={() => { location.href = raw(file); }}>Download</Button>
                </div>
                {/\.md$/i.test(file) ? <Markdown text={shown.data.text} /> : <pre className="fx-mono axp-axhub-call">{shown.data.text}</pre>}
              </div>
            )}
          </Container>
        )}
        <table className="fx-table">
          <tbody>
            {run.files.map((f) => (
              <tr key={f.path}>
                <th><Button size="sm" tone="ghost" icon="file" onClick={() => go(rt, 'handoff-run', { id: run.id, file: f.path })}>{f.path}</Button></th>
                <td>{f.bytes < 1024 ? `${f.bytes} B` : `${Math.round(f.bytes / 1024)} KB`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Container>
  );
}
