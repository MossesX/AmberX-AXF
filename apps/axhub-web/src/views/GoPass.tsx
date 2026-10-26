/**
 * Go pass (axHub decision #99): a Claude session that can't reach axHub to load the rules and THREADS.md does nothing
 * until Brett says go here. The hub writes the pass to the `go-pass` branch of each watched repo (never the default
 * branch), where such a session can read it; it ends by itself after the hours picked, or now with End.
 */
import { useState } from 'react';
import { Button, Chip, Container, Note, TextField, useRuntime } from '../axf/react';
import { hubPost } from '../hub/api';
import { relTime } from '../hub/core';
import { HubGate, TapTwice, useHubJson, when } from './hubPage';

interface GoPassView {
  live: boolean;
  hours: number[];
  repos: string[];
  branch: string;
  file: string;
  pass?: { state: 'go' | 'ended'; issuedAt: string; expiresAt: string; hours: number; by: string; note: string };
  writes: { repo: string; ok: boolean; at: string; error?: string }[];
}

export function GoPass() {
  return <HubGate admin what="the go pass">{() => <Page />}</HubGate>;
}

function Page() {
  const rt = useRuntime();
  const res = useHubJson<GoPassView>('/auth/api/go-pass', 30_000);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const v = res.data;
  const send = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const r = await hubPost<GoPassView>(path, body);
      res.setData(r);
      const failed = r.writes.filter((w) => !w.ok).length;
      rt.toast(failed ? `${done}, but ${failed} repo${failed === 1 ? '' : 's'} refused it.` : done, failed ? 'warning' : 'success');
    } catch (e) {
      rt.toast(e instanceof Error ? e.message : String(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Sessions that can't reach axHub</p>
          <h1>Go pass</h1>
          <p className="fx-muted">A Claude chat that can't load your rules and threads from axHub does nothing until you say go here.</p>
        </div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {v && (
        <>
          <Container title={v.live ? 'Go: sessions may work' : 'No go: sessions wait'} icon={v.live ? 'check' : 'pause'} actions={<Chip tone={v.live ? 'success' : 'warning'}>{v.live ? 'Live' : 'Off'}</Chip>}>
            <div className="fx-stack">
              {v.pass && v.live && (
                <p>Given by {v.pass.by} {relTime(v.pass.issuedAt)} for {v.pass.hours} h · ends {when(v.pass.expiresAt)} ({relTime(v.pass.expiresAt)}){v.pass.note ? ` · ${v.pass.note}` : ''}</p>
              )}
              {v.pass && !v.live && <p className="fx-muted">Last pass {v.pass.state === 'ended' ? `ended by ${v.pass.by}` : 'ran out'} {relTime(v.pass.expiresAt)}.</p>}
              <TextField label="Note (optional, shown in the pass)" value={note} onChange={setNote} placeholder="e.g. Working from the phone" />
              <div className="fx-row fx-row--wrap">
                {v.hours.map((h) => (
                  <Button key={h} tone="success" disabled={busy} onClick={() => void send('/auth/api/go-pass', { hours: h, note }, `Go for ${h} h`)}>
                    Go for {h} h
                  </Button>
                ))}
                {v.live && <TapTwice label="End it now" again="Tap again to end" tone="danger" disabled={busy} onConfirm={() => void send('/auth/api/go-pass/end', {}, 'Pass ended')} />}
              </div>
            </div>
          </Container>
          <Container title="Where it's written" icon="branch" collapsible defaultOpen={false}>
            <div className="fx-stack">
              <p className="fx-muted">{v.file} on the {v.branch} branch of each repo (never main). Sessions read it with <code>git fetch origin {v.branch}</code>.</p>
              {v.writes.length === 0 ? <p className="fx-muted">Nothing written yet.</p> : (
                <table className="fx-table"><tbody>
                  {v.writes.map((w) => <tr key={w.repo}><th>{w.repo}</th><td>{w.ok ? `Written ${relTime(w.at)}` : `Failed: ${w.error ?? 'GitHub refused it'}`}</td></tr>)}
                </tbody></table>
              )}
              {v.repos.length === 0 && <Note tone="warning">No repos are set (AXHUB_GO_PASS_REPOS on the hub).</Note>}
            </div>
          </Container>
        </>
      )}
    </div>
  );
}
