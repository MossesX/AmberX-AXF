import { useEffect, useRef, useState } from 'react';
import { Button, Icon, IconButton, useRuntime } from '@console/axf/react';
import * as pc from './plan-core.mjs';
import * as ai from './plan-ai.mjs';
import type { Plan } from './plan-core.mjs';
import { applyAi, askAi, KEYS, turnIntoBuild, undoFor, useAiInfo, useStudio, type AiResult } from './api';
import { canListen, hasAgentVoice, listenOnce, micLease, runConversation, speakOut, type TurnResult } from './voice';

/*
 * The plain-English command box (on every plan and on the studio home) and the voice conversation. Type or dictate;
 * the AI turns it into plan@1 edits, shown as a diff to Apply or Discard (or applied at once with one-tap Undo when
 * "Apply small edits straight away" is on). Every AI edit is saved with the note "AI, from: <what was said>".
 */

const setting = (rt: ReturnType<typeof useRuntime>, k: string, d: unknown) => { try { const v = rt.settings.get(k); return v === undefined || v === null || v === '' ? d : v; } catch { return d; } };

/** Lines describing what an AI result would change. */
export function changeLines(r: AiResult, before: Plan | null): string[] {
  const out: string[] = [];
  if (r.plan && before) out.push(...pc.describeDiff(pc.diff(before, r.plan)));
  for (const p of r.others ?? []) out.push(`${p.title}: ${(r.summary ?? []).filter((s) => s.includes(p.title)).join('; ') || 'changed'}`);
  for (const p of r.created ?? []) out.push(`+ new plan: ${p.title} (${p.status})`);
  return out;
}

export function CommandBox({ plan, onOpen }: { plan: Plan | null; onOpen?: (id: string) => void }) {
  const rt = useRuntime();
  const info = useAiInfo();
  const { state } = useStudio();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AiResult | null>(null);
  const [said, setSaid] = useState('');
  const [msg, setMsg] = useState('');
  const [undo, setUndo] = useState<null | (() => Promise<string>)>(null);
  const [dictating, setDictating] = useState(false);
  const autoApply = setting(rt, KEYS.autoApply, false) === true;

  const apply = async (r: AiResult, t: string) => {
    const before = [plan, ...(r.others ?? []).map((o) => state?.plans.find((p) => p.id === o.id) ?? null)].filter(Boolean) as Plan[];
    const out = await applyAi(r.ops ?? [], t, plan?.id);
    setUndo(() => undoFor(before, out.saved, t));
    setMsg(out.say || 'Applied.');
    setRes(null);
    const created = (r.created ?? [])[0];
    if (created && !plan) { const s = out.saved.find((p) => p.title === created.title); if (s) onOpen?.(s.id); }
  };
  const send = async (t = text) => {
    const q = t.trim(); if (!q) return;
    setBusy(true); setMsg(''); setRes(null); setUndo(null);
    try {
      const r = await askAi(q, plan?.id);
      if (!r.ok) { setMsg(r.error || 'That did not work.'); return; }
      setSaid(q); setText('');
      const edits = (r.ops ?? []).filter((o) => !['answer', 'ask'].includes(o.op));
      if (!edits.length) { setMsg(r.ask || r.answer || r.say || 'Nothing to change.'); return; }
      if (autoApply && ai.isSmall(r.ops ?? [])) { await apply(r, q); return; }
      setRes(r);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const dictate = async () => {
    if (!micLease().take('plan-studio', 20_000)) { setMsg('Something else is using the microphone.'); return; }
    setDictating(true);
    try { const heard = await listenOnce(String(setting(rt, KEYS.voiceLang, 'en-US'))); if (heard) { setText(heard); await send(heard); } }
    catch (e) { setMsg((e as Error).message); }
    finally { micLease().release('plan-studio'); setDictating(false); }
  };
  const lines = res ? changeLines(res, plan) : [];
  const noAi = info && !info.available;

  return (
    <div className="axp-plan-studio__cmd" role="group" aria-label="Tell the plan AI what to change">
      <form className="axp-plan-studio__cmdrow" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="fx-search axp-plan-studio__cmdin">
          <Icon name="sparkles" size={13} />
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            placeholder={plan ? 'Tell it: "add a step for the installer, Opus, 20 minutes"' : 'Tell it: "new plan: docs website, parked" · "what\'s left on Docs Studio?"'} aria-label="Plain-English request" />
        </label>
        {canListen() && <IconButton icon="mic" label={dictating ? 'Listening…' : 'Dictate'} onClick={() => void dictate()} disabled={busy || dictating} />}
        <Button size="sm" tone="primary" icon="arrow-right" type="submit" busy={busy} disabled={!text.trim()}>Go</Button>
      </form>
      {noAi && <p className="fx-muted axp-plan-studio__cmdnote">Simple requests work without AI. For anything else, set up an AI provider: <button type="button" className="fx-btn fx-btn--quiet fx-btn--sm" onClick={() => rt.dispatch(info?.setup || 'settings.open:ai')}>Set up AI</button></p>}
      {msg && (
        <div className="axp-plan-studio__cmdmsg" role="status">
          <span>{msg}</span>
          {undo && <Button size="sm" tone="quiet" icon="undo" onClick={async () => { const u = undo; setUndo(null); setMsg(await u()); }}>Undo</Button>}
        </div>
      )}
      {res && (
        <div className="axp-plan-studio__diff" role="region" aria-label="Proposed changes">
          <p className="axp-plan-studio__difftitle"><Icon name="sparkles" size={12} /> From “{said}”{res.via === 'model' ? ` · ${res.model || 'AI'}` : ''}</p>
          <ul>{(lines.length ? lines : res.summary ?? []).map((l, i) => <li key={i} className={l.startsWith('+') ? 'is-add' : l.startsWith('−') ? 'is-del' : ''}>{l}</li>)}</ul>
          <div className="fx-row">
            <Button size="sm" tone="primary" icon="check" onClick={() => void apply(res, said)}>Apply</Button>
            <Button size="sm" tone="quiet" icon="x" onClick={() => setRes(null)}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- voice conversation */

export function VoicePanel({ plan, onClose, onOpen }: { plan: Plan | null; onClose: () => void; onOpen?: (id: string) => void }) {
  const rt = useRuntime();
  const { state } = useStudio();
  const [log, setLog] = useState<{ kind: string; text: string }[]>([]);
  const [phase, setPhase] = useState('starting');
  const stop = useRef(false);
  const planRef = useRef<string>(plan?.id ?? '');
  const plansRef = useRef(state?.plans ?? []);
  plansRef.current = state?.plans ?? [];

  useEffect(() => {
    stop.current = false;
    const agentVoice = setting(rt, KEYS.voiceOut, 'auto') !== 'device' && hasAgentVoice(rt.libraries as { provides?: string[] }[]);
    const lang = String(setting(rt, KEYS.voiceLang, 'en-US'));
    const handle = async (heard: string): Promise<TurnResult> => {
      const cur = () => plansRef.current.find((p) => p.id === planRef.current) ?? null;
      const tb = /^(?:turn|make|send)\s+(this|it|the plan|.+?)\s+into\s+a\s+build(?:\s+(?:in|on|for)\s+(?:the\s+)?([a-z0-9-]+)(?:\s+profile)?)?$/i.exec(heard.trim().replace(/[.!?]+$/, ''));
      if (tb) {
        const target = /^(this|it|the plan)$/i.test(tb[1]!) ? cur() : ai.findPlan(plansRef.current, tb[1]!);
        if (!target) return { say: 'Which plan should become a build? Open it first or say its name.' };
        const profile = tb[2] || target.profile || state?.activeProfile || '';
        const prof = state?.profiles.find((p) => p.id === profile || p.label.toLowerCase() === profile.toLowerCase())?.id ?? profile;
        const pre = await turnIntoBuild(target.id, prof, true);
        if (!pre.ok) return { say: pre.error || 'That plan cannot become a build yet.' };
        return { say: '', confirm: { question: `Turn ${target.title} into a build in ${prof}, ${pre.change?.steps.length ?? 0} steps, about ${pc.fmtMinutes(pre.minutes ?? 0)}?`, run: async () => { const r = await turnIntoBuild(target.id, prof, false); return { say: r.ok ? `Done. It's build ${r.build?.id} in ${prof}.` : r.error || 'That did not work.' }; } } };
      }
      const open = /^(?:open|go to|switch to|work on)\s+(?:the\s+)?(.+?)(?:\s+plan)?$/i.exec(heard.trim());
      if (open) { const p = ai.findPlan(plansRef.current, open[1]!); if (p) { planRef.current = p.id; onOpen?.(p.id); return { say: `Opened ${p.title}.` }; } }
      const r = await askAi(heard, planRef.current);
      if (!r.ok) return { say: r.error || 'That did not work.' };
      const edits = (r.ops ?? []).filter((o) => !['answer', 'ask'].includes(o.op));
      if (!edits.length) return { say: r.ask || r.answer || r.say || 'I have nothing to change for that.' };
      const doApply = async (): Promise<TurnResult> => {
        const before = [cur(), ...(r.others ?? []).map((o) => plansRef.current.find((p) => p.id === o.id) ?? null)].filter(Boolean) as Plan[];
        const out = await applyAi(r.ops ?? [], heard, planRef.current);
        const created = (r.created ?? [])[0];
        if (created && !planRef.current) { const s = out.saved.find((p) => p.title === created.title); if (s) { planRef.current = s.id; onOpen?.(s.id); } }
        return { say: `${out.say} Say undo that to take it back.`, undo: undoFor(before, out.saved, heard) };
      };
      if (ai.isBig(r.ops ?? [])) return { say: '', confirm: { question: `${r.say || (r.summary ?? []).join('. ')}. Shall I do that?`, run: doApply } };
      return doApply();
    };
    void runConversation({
      listen: () => listenOnce(lang),
      speak: (t) => speakOut(t, { agentVoice, lang }),
      lease: micLease(),
      stopped: () => stop.current,
      onEvent: (e) => { if (e.kind === 'state') setPhase(e.text); else setLog((l) => [...l.slice(-40), e]); },
    }, handle, { greeting: plan ? `Plan Studio here, on ${plan.title}. What should we change?` : 'Plan Studio here. What would you like to plan?' }).then((r) => setPhase(r.ended === 'done' ? 'ended' : r.ended));
    return () => { stop.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = !['ended', 'busy', 'silence', 'stopped', 'limit', 'error'].includes(phase);
  return (
    <div className="axp-plan-studio__voice" role="dialog" aria-label="Talk to Plan Studio">
      <div className="axp-plan-studio__voicehead">
        <span className={`axp-plan-studio__voicedot is-${phase}`} aria-hidden />
        <b>{live ? (phase === 'listening' ? 'Listening…' : phase === 'thinking' ? 'Thinking…' : 'Talking') : 'Conversation ended'}</b>
        <span className="fx-muted">Say “undo that”, “say that again” or “I'm done”.</span>
        <span className="axp-plan-studio__grow" />
        {live ? <Button size="sm" icon="x" onClick={() => { stop.current = true; setPhase('stopped'); }}>Stop</Button> : <Button size="sm" icon="x" onClick={onClose}>Close</Button>}
      </div>
      <ol className="axp-plan-studio__voicelog">
        {log.map((e, i) => <li key={i} className={`is-${e.kind}`}><Icon name={e.kind === 'heard' ? 'user' : e.kind === 'error' ? 'alert' : 'sparkles'} size={12} /> {e.text}</li>)}
      </ol>
    </div>
  );
}
