import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Checkbox, Slider, useRuntime } from '@console/axf/react';
import * as core from './swarm-core.mjs';
import { Bubble } from './chat';
import type { Act, ChatSettings, SwarmState } from './ui-types';

/*
 * Chat settings suite: the vibe ceiling (1–500), chattiness, cussing and drama sliders, per-agent overrides, the
 * daily banter budget, presets (built in + your own) and a live preview line that changes as the sliders move.
 * Color by vibe is a display choice on this device (console setting), also in the chat window's right-click menu.
 */

export const KEYS = { colorByVibe: 'agent-swarm.colorByVibe', vibeColor: 'agent-swarm.vibeColor' } as const;
export const COLOR_BY_VIBE_ACTION = 'agent-swarm.color-by-vibe';

export function useSetting<T>(key: string, fallback: T): T {
  const rt = useRuntime();
  return useSyncExternalStore((fn) => rt.settings.subscribe(fn), () => (rt.settings.get(key) ?? fallback) as T, () => fallback);
}

const VIBE_WORDS = (v: number) => (v <= 20 ? 'straight to the point, no sarcasm' : v <= 140 ? 'chill' : v <= 300 ? 'full Amber' : v <= 420 ? 'wild' : 'off the rails');
const SLIDER_INFO = {
  vibe: { label: 'Vibe', max: 500, hint: '1 = straight to the point · 100 = chill · 250 = full Amber · 500 = off the rails. A hard ceiling: anything above it is toned down or dropped.' },
  chattiness: { label: 'Chattiness', max: 100, hint: '0 = assignments only … 100 = constant banter.' },
  cussing: { label: 'Cussing', max: 100, hint: '0 = clean … 100 = filthy.' },
  drama: { label: 'Drama', max: 100, hint: 'Fights over files, jealousy, shit talk. Under 30 = none.' },
} as const;
type Key = keyof typeof SLIDER_INFO;

export function ChatSettingsTab({ state, act }: { state: SwarmState; act: Act }) {
  const rt = useRuntime();
  const saved = state.swarm.chatSettings;
  const [cs, setCs] = useState<ChatSettings>(saved);
  const [name, setName] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setCs(saved); }, [saved]);
  const colorBy = useSetting<boolean>(KEYS.colorByVibe, false);
  const base = useSetting<string>(KEYS.vibeColor, 'accent');
  // sliders save a moment after they stop moving; the preview follows every move
  const move = (k: Key, v: number) => {
    setCs((x) => ({ ...x, [k]: v, preset: 'custom' }));
    clearTimeout(timer.current); timer.current = setTimeout(() => void act({ action: 'chat-settings', values: { [k]: v } }), 450);
  };
  const preview = core.previewLine(cs) as { text: string; vibe: number | null };
  const agents = new Map(state.roster.agents.map((a) => [a.id, a]));
  return (
    <div className="fx-stack">
      <section className="fx-stack">
        <h2 className="sw-wave">Presets</h2>
        <div className="sw-bar" role="group" aria-label="Presets">
          {Object.entries(core.PRESETS).map(([id, p]) => <Button key={id} size="sm" aria-pressed={cs.preset === id} onClick={() => void act({ action: 'chat-settings', preset: id })}>{p.label}</Button>)}
          {cs.saved.map((p) => <span key={p.name} className="sw-bar"><Button size="sm" aria-pressed={cs.preset === p.name} onClick={() => void act({ action: 'chat-settings', preset: p.name })}>{p.name}</Button><Button size="sm" icon="x" aria-label={`Remove preset ${p.name}`} onClick={() => void act({ action: 'chat-settings', forget: p.name })} /></span>)}
        </div>
        <form className="sw-bar" onSubmit={(e) => { e.preventDefault(); void act({ action: 'chat-settings', save: name }).then((l) => { if (l) setName(''); }); }}>
          <input className="fx-input sw-grow" aria-label="New preset name" placeholder="Save these settings as…" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" icon="save" disabled={!name.trim()}>Save preset</Button>
        </form>
      </section>
      <section className="fx-stack">
        <h2 className="sw-wave">The room · {VIBE_WORDS(cs.vibe)}</h2>
        {(Object.keys(SLIDER_INFO) as Key[]).map((k) => (
          <div key={k} className="sw-slider">
            <Slider label={SLIDER_INFO[k].label} value={cs[k]} min={k === 'vibe' ? 1 : 0} max={SLIDER_INFO[k].max} onChange={(v) => move(k, v)} />
            <p className="fx-muted">{SLIDER_INFO[k].hint}</p>
          </div>
        ))}
        <div className="sw-preview" aria-live="polite">
          <p className="fx-muted">Live preview{preview.vibe != null ? ` · vibe ${preview.vibe}` : ''}</p>
          <ul className="sw-msgs"><Bubble m={{ id: 'preview', at: '', from: 'rio', kind: 'banter', text: preview.text, jobId: '', vibe: preview.vibe, toned: false }} agents={agents} ceiling={colorBy ? cs.vibe : undefined} /></ul>
        </div>
      </section>
      <section className="sw-bar">
        <label className="fx-muted" htmlFor="sw-bb">Daily banter budget ($)</label>
        <input id="sw-bb" className="fx-input sw-num" type="number" min={0} step={0.1} defaultValue={cs.banterBudget} key={cs.banterBudget} onBlur={(e) => { const v = Number(e.target.value); if (v !== cs.banterBudget) void act({ action: 'chat-settings', banterBudget: v }); }} />
        <span className="fx-muted">spent today {core.fmtUsd(state.banterToday ?? 0)}; quiet once it's hit</span>
      </section>
      <section className="fx-stack">
        <h2 className="sw-wave">Color by vibe</h2>
        <div className="sw-bar">
          <Checkbox label="Color every message by its vibe score" checked={colorBy} onChange={(v) => rt.settings.set(KEYS.colorByVibe, v)} />
          <select className="fx-input sw-bar__pick" aria-label="Base colour" value={base} onChange={(e) => rt.settings.set(KEYS.vibeColor, e.target.value)}>
            {core.VIBE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className={`sw-swatch is-${base}`} aria-hidden="true" />
        </div>
        <p className="fx-muted">Light near 1, darker as the score rises, darkest at the ceiling. Also in the chat window's right-click menu.</p>
      </section>
      <section className="fx-stack">
        <h2 className="sw-wave">Per agent</h2>
        <div className="sw-scroll"><table className="sw-table">
          <thead><tr><th>Agent</th>{(Object.keys(SLIDER_INFO) as Key[]).map((k) => <th key={k} className="is-num">{SLIDER_INFO[k].label}</th>)}<th /></tr></thead>
          <tbody>{state.roster.agents.map((a) => {
            const o: Partial<Record<Key, number>> = cs.overrides[a.id] ?? {};
            return (
              <tr key={a.id}>
                <td>{a.name}</td>
                {(Object.keys(SLIDER_INFO) as Key[]).map((k) => (
                  <td key={k} className="is-num"><input className="fx-input sw-num" type="number" min={k === 'vibe' ? 1 : 0} max={SLIDER_INFO[k].max} aria-label={`${a.name} ${SLIDER_INFO[k].label}`} placeholder={String(cs[k])} defaultValue={o[k] ?? ''} key={`${a.id}${k}${o[k] ?? ''}`}
                    onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (o[k] ?? null)) void act({ action: 'chat-settings', agent: a.id, override: { ...o, [k]: v } }); }} /></td>
                ))}
                <td>{Object.keys(o).length > 0 && <Button size="sm" onClick={() => void act({ action: 'chat-settings', agent: a.id, override: null })}>Use the room</Button>}</td>
              </tr>);
          })}</tbody>
        </table></div>
        <p className="fx-muted">Blank = the room's setting.</p>
      </section>
    </div>
  );
}
