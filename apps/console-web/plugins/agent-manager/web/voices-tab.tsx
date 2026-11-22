/*
 * Voices tab: every employee (agents + personas) with the voice it speaks with, a picker per row and Match all from
 * hints. Deep link: action `agent-manager.voices` (console_open / console_show target), REST GET voices.
 */
import { useEffect, useState } from 'react';
import { Button, Chip } from '@console/axf/react';
import { EmptyState } from '@console/emptyState';
import { call, put, refresh, type Voice } from './api';
import { VoicePicker, deviceVoices } from './voice-picker';

export interface RosterRow { kind: 'agent' | 'persona'; id: string; name: string; voice: Voice | null; speaks: Voice | null; from: 'agent' | 'persona'; personaId?: string }
export const TAB_EVENT = 'agent-manager:tab';

export const voiceLabel = (v: Voice | null | undefined) => {
  if (!v || !(v.voiceId || v.provider || v.rate !== undefined || v.pitch !== undefined)) return v?.hint ? `not picked yet · “${v.hint}”` : 'device default';
  const who = v.voiceId || (v.provider === 'browser' || !v.provider ? 'device default' : v.provider);
  const tune = [v.rate !== undefined && v.rate !== 1 ? `speed ${Math.round(v.rate * 100)}%` : '', v.pitch !== undefined && v.pitch !== 1 ? `pitch ${Math.round(v.pitch * 100)}%` : ''].filter(Boolean).join(', ');
  return [v.provider && v.provider !== 'browser' ? `${v.provider}: ${who}` : who, tune].filter(Boolean).join(' · ');
};

/** PUT voice/{agents|personas}/{id}; with `match` the device's voices go along for device-voice slots. */
export async function saveVoice(kind: 'agent' | 'persona', id: string, body: Record<string, unknown>) {
  const coll = kind === 'agent' ? 'agents' : 'personas';
  if (body.match && (!body.provider || body.provider === 'browser')) body = { ...body, voices: await deviceVoices() };
  const r = await put<{ item: unknown; match: { why: string } | null }>(`voice/${coll}/${encodeURIComponent(id)}`, body);
  void refresh().catch(() => undefined);
  return r;
}

/** Match every employee that has a hint and no picked voice yet. */
export async function matchAll(): Promise<string[]> {
  const rows = (await call<{ roster: RosterRow[] }>('voices')).roster;
  const voices = await deviceVoices();
  const out: string[] = [];
  for (const r of rows) {
    if (!r.voice?.hint || r.voice.voiceId) continue;
    const coll = r.kind === 'agent' ? 'agents' : 'personas';
    const res = await put<{ match: { why: string } | null }>(`voice/${coll}/${encodeURIComponent(r.id)}`, { match: true, voices: r.voice.provider && r.voice.provider !== 'browser' ? undefined : voices });
    out.push(`${r.name}: ${res.match?.why ?? 'set'}`);
  }
  void refresh().catch(() => undefined);
  return out;
}

export function VoicesTab() {
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [open, setOpen] = useState('');
  const [draft, setDraft] = useState<Voice>({});
  const [msg, setMsg] = useState('');
  const load = () => call<{ roster: RosterRow[] }>('voices').then((r) => setRows(r.roster)).catch((e: Error) => setMsg(e.message));
  useEffect(() => { void load(); }, []);

  const key = (r: RosterRow) => `${r.kind}:${r.id}`;
  const save = async (r: RosterRow) => {
    try { await saveVoice(r.kind, r.id, { ...draft, provider: draft.provider ?? '', voiceId: draft.voiceId ?? '', hint: draft.hint ?? '' }); setMsg(`${r.name}'s voice saved.`); setOpen(''); void load(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const all = async () => {
    try { const l = await matchAll(); setMsg(l.length ? l.join(' · ') : 'Nobody has a hint without a voice.'); void load(); } catch (e) { setMsg((e as Error).message); }
  };

  if (rows && !rows.length) return <EmptyState icon="user">No agents or personas yet. Make an agent first; each one gets a voice here.</EmptyState>;
  return (
    <div className="fx-stack" data-axf-target="view:agent-manager/tab:agent-manager.tabs=voices">
      <div className="fx-row" role="toolbar" aria-label="Voices">
        <Button size="sm" icon="sparkles" onClick={() => void all()} data-axf-target="view:agent-manager/voices/match-all">Match all from hints</Button>
        <span className="fx-small fx-muted">Each agent speaks in its own voice in group chat audio and through Agent voice. An agent with no voice of its own uses its persona's.</span>
      </div>
      {msg && <span className="fx-small fx-muted" role="status">{msg}</span>}
      {(rows ?? []).map((r) => (
        <div key={key(r)} className="fx-card fx-stack axp-agent-manager__voice-row">
          <div className="fx-row axp-agent-manager__voice-head">
            <strong>{r.name}</strong>
            <Chip>{r.kind}</Chip>
            <span className="fx-small fx-muted">{voiceLabel(r.speaks)}{r.kind === 'agent' && r.from === 'persona' && r.speaks ? ' (from its persona)' : ''}</span>
                        <Button size="sm" tone="ghost" onClick={() => { if (open === key(r)) setOpen(''); else { setOpen(key(r)); setDraft(r.voice ?? {}); } }} data-axf-target={`view:agent-manager/voice:${r.kind}=${r.id}/edit`}>{open === key(r) ? 'Close' : 'Change'}</Button>
          </div>
          {open === key(r) && (
            <>
              <VoicePicker value={draft} onChange={setDraft} name={r.name} agentId={r.kind === 'agent' ? r.id : undefined} target={`view:agent-manager/voice:${r.kind}=${r.id}`} />
              <div className="fx-row" role="toolbar" aria-label={`Save ${r.name}'s voice`}>
                <Button size="sm" tone="primary" onClick={() => void save(r)} data-axf-target={`view:agent-manager/voice:${r.kind}=${r.id}/save`}>Save voice</Button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
