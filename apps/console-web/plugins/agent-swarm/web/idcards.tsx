import { useMemo, useState, type ReactNode } from 'react';
import { AgentCard, Button, Chip, IconButton, useAxfState, useRuntime } from '@console/axf/react';
import { AGENT_CARD_SAMPLE, CARD_ENUMS, CARD_FIELDS, agentCardErrors, normalizeCard, type AgentCardData, type CardField, type CardStats } from '@console/axf/core/engines/agent-card-rules.mjs';
import * as consoleApi from '@console/api';
import * as core from './swarm-core.mjs';
import { statusText, type Act, type Agent, type CardDesign, type SwarmState } from './ui-types';

/*
 * ID cards (agent-card@1): the gallery of every design (the framework's starters + designs saved here) drawn with a
 * real agent in the current theme, the default pick, the card designer (Save as new = a new agent-card asset), and
 * the per-agent card (design override + editable identity) shown on each profile. Rules and the renderer are the
 * framework's (core/engines/agent-card-rules.mjs, react/components/AgentCard.tsx); this file only picks and edits.
 */

type Design = { id: string; name: string; description: string; data: Partial<AgentCardData>; saved: boolean };
type CardStatsIn = { done: number; successRate: number | null; favoriteModel: string };

/** Every design: the app's agent-card assets first, then the ones saved in the swarm. */
export function useDesigns(state: SwarmState): Design[] {
  const rt = useRuntime();
  useAxfState();
  return useMemo(() => [
    ...rt.registry.list('agent-card').map((a) => ({ id: a.id, name: a.name, description: a.description ?? '', data: a.data as Partial<AgentCardData>, saved: false })),
    ...state.swarm.cards.designs.map((d: CardDesign) => ({ id: d.id, name: d.name, description: d.description ?? 'Saved in the card designer.', data: d.data as Partial<AgentCardData>, saved: true })),
  ], [rt, state.swarm.cards.designs]);
}
const designOf = (designs: Design[], id: string) => designs.find((d) => d.id === id)?.data ?? null;

export function cardStats(state: SwarmState, a: Agent, st: CardStatsIn | undefined): CardStats {
  return { jobs: st?.done ?? 0, successRate: st?.successRate == null ? undefined : st.successRate * 100, spend: state.spend[a.id]?.all.usd ?? 0, favoriteModel: core.MODEL_LABEL[st?.favoriteModel || a.models[0] || ''] ?? '' };
}
const identityOf = (state: SwarmState, a: Agent) => core.cardIdentity(a, state.swarm.agents[a.id], statusText(state.swarm.agents[a.id]!, state.statuses));

/** One agent's card, in its design (its own pick, else the swarm default, else the app's active asset). */
export function AgentIdCard({ state, a, st, designs, design, photo }: { state: SwarmState; a: Agent; st?: CardStatsIn; designs: Design[]; design?: Partial<AgentCardData> | null; photo?: ReactNode }) {
  const id = identityOf(state, a);
  const d = design !== undefined ? design : designOf(designs, core.cardFor(state.swarm, a.id));
  return <AgentCard identity={id} stats={cardStats(state, a, st)} design={d} photo={id.photo ? <img src={id.photo} alt="" /> : photo} />;
}

/* ---------------------------------------------------------------- gallery + default pick */

export function CardsTab({ state, stats, act, photo }: { state: SwarmState; stats: Record<string, CardStatsIn>; act: Act; photo: (a: Agent) => ReactNode }) {
  const rt = useRuntime();
  const designs = useDesigns(state);
  const [who, setWho] = useState(() => consoleApi.readLocal('swarm-card-sample', state.roster.agents[0]?.id ?? ''));
  const a = state.roster.agents.find((x) => x.id === who) ?? state.roster.agents[0];
  const current = state.swarm.cards.default || rt.assetOrNull('agent-card')?.id || '';
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null) return <Designer state={state} designs={designs} base={editing} act={act} onDone={() => setEditing(null)} />;
  return (
    <div className="fx-stack">
      <p className="fx-muted">Every agent's ID card uses the default design unless you pick another one on their profile. Cards take their colours from the theme, so switching the theme rebrands them all.</p>
      <div className="sw-bar">
        <label className="fx-muted" htmlFor="sw-card-who">Show</label>
        <select id="sw-card-who" className="fx-input sw-bar__pick" value={a?.id ?? ''} onChange={(e) => { setWho(e.target.value); consoleApi.writeLocal('swarm-card-sample', e.target.value); }}>
          {state.roster.agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <Button size="sm" icon="plus" onClick={() => setEditing(current)}>New design…</Button>
      </div>
      <div className="sw-idcards" role="list">
        {designs.map((d) => (
          <figure key={d.id} role="listitem" className="sw-idcards__item">
            {a ? <AgentIdCard state={state} a={a} st={stats[a.id]} designs={designs} design={d.data} photo={photo(a)} /> : <AgentCard identity={AGENT_CARD_SAMPLE.identity} stats={AGENT_CARD_SAMPLE.stats} design={d.data} />}
            <figcaption className="fx-stack">
              <span><b>{d.name}</b> {d.id === current && <Chip tone="accent">Default</Chip>} {d.saved && <Chip>Saved here</Chip>}</span>
              <span className="fx-muted">{d.description}</span>
              <span className="sw-bar">
                {d.id !== current && <Button size="sm" onClick={() => void act({ action: 'card-default', design: d.id, name: d.name })}>Make default</Button>}
                <Button size="sm" tone="ghost" onClick={() => setEditing(d.id)}>Edit as new</Button>
                {d.saved && <Button size="sm" tone="ghost" onClick={() => void act({ action: 'card-delete', design: d.id })}>Remove</Button>}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- designer: edit a design, Save as new */

const ENUM_LABELS: Record<keyof typeof CARD_ENUMS, string> = { design: 'Design', orientation: 'Orientation', logo: 'Logo', surface: 'Background', accent: 'Accent colour', finish: 'Finish', photo: 'Photo', code: 'Code strip' };
const FIELD_IDS = Object.keys(CARD_FIELDS) as CardField[];

function SideEditor({ title, side, value, labels, onChange, onLabel }: { title: string; side: 'front' | 'back'; value: CardField[]; labels: Partial<Record<CardField, string>>; onChange: (v: CardField[]) => void; onLabel: (f: CardField, v: string) => void }) {
  const move = (i: number, by: number) => { const v = [...value]; const [x] = v.splice(i, 1); v.splice(i + by, 0, x!); onChange(v); };
  return (
    <fieldset className="fx-stack sw-fields">
      <legend className="sw-wave">{title}</legend>
      {value.map((f, i) => (
        <div key={f} className="sw-bar">
          <span className="sw-grow">{CARD_FIELDS[f]}</span>
          <input className="fx-input sw-bar__pick" aria-label={`${CARD_FIELDS[f]} label on the ${side}`} placeholder={CARD_FIELDS[f]} value={labels[f] ?? ''} maxLength={24} onChange={(e) => onLabel(f, e.target.value)} />
          <IconButton icon="chevron-up" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
          <IconButton icon="chevron-down" label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)} />
          <IconButton icon="x" label={`Take ${CARD_FIELDS[f]} off`} onClick={() => onChange(value.filter((x) => x !== f))} />
        </div>
      ))}
      <select className="fx-input sw-bar__pick" aria-label={`Add a field to the ${side}`} value="" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value as CardField]); }}>
        <option value="">Add a field…</option>
        {FIELD_IDS.filter((f) => !value.includes(f)).map((f) => <option key={f} value={f}>{CARD_FIELDS[f]}</option>)}
      </select>
    </fieldset>
  );
}

function Designer({ state, designs, base, act, onDone }: { state: SwarmState; designs: Design[]; base: string; act: Act; onDone: () => void }) {
  const from = designs.find((d) => d.id === base);
  const [data, setData] = useState<AgentCardData>(() => normalizeCard(from?.data));
  const [name, setName] = useState(from ? `${from.name} copy` : 'My card');
  const [id, setId] = useState(() => `${(from?.id ?? 'card').slice(0, 40)}-copy`);
  const [err, setErr] = useState('');
  const a = state.roster.agents[0];
  const taken = designs.map((d) => d.id);
  const set = <K extends keyof AgentCardData>(k: K, v: AgentCardData[K]) => setData({ ...data, [k]: v });
  const label = (f: CardField, v: string) => { const labels = { ...data.labels }; if (v.trim()) labels[f] = v; else delete labels[f]; set('labels', labels); };
  const save = async () => {
    const errors = agentCardErrors('agent-card', data);
    if (errors.length) { setErr(errors.join('; ')); return; }
    const log = await act({ action: 'card-save', taken, asset: { id, name, description: `Made in the card designer from ${from?.name ?? 'the default'}.`, data } });
    if (log) onDone();
  };
  return (
    <div className="fx-stack">
      <div className="sw-bar"><Button icon="undo" onClick={onDone}>Cards</Button><span className="fx-muted">Editing a copy of {from?.name ?? 'the default design'}. Saving makes a new design; the original stays as it is.</span></div>
      <div className="sw-designer">
        <div className="fx-stack">
          <div className="sw-bar">
            <input className="fx-input sw-grow" aria-label="Design name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="fx-input sw-bar__pick" aria-label="Design id" value={id} onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
          </div>
          <div className="sw-enums">
            {(Object.keys(CARD_ENUMS) as (keyof typeof CARD_ENUMS)[]).map((k) => (
              <label key={k} className="fx-stack sw-enum">
                <span className="fx-muted">{ENUM_LABELS[k]}</span>
                <select className="fx-input" value={data[k] as string} onChange={(e) => set(k, e.target.value as never)}>
                  {CARD_ENUMS[k].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            ))}
          </div>
          <SideEditor title="Front" side="front" value={data.front} labels={data.labels} onChange={(v) => set('front', v)} onLabel={label} />
          <SideEditor title="Back (flip)" side="back" value={data.back} labels={data.labels} onChange={(v) => set('back', v)} onLabel={label} />
          {err && <p className="sw-warn">{err}</p>}
          <div className="sw-bar"><Button tone="primary" disabled={!id || !name.trim() || taken.includes(id)} onClick={() => void save()}>Save as new</Button>{taken.includes(id) && <span className="sw-warn">“{id}” is taken</span>}</div>
        </div>
        <div className="fx-stack">
          <span className="fx-muted">Live preview</span>
          {a ? <AgentIdCard state={state} a={a} designs={designs} design={data} /> : <AgentCard identity={AGENT_CARD_SAMPLE.identity} stats={AGENT_CARD_SAMPLE.stats} design={data} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- per agent: design override + identity */

const ID_LABELS: Record<string, string> = { name: 'Name', role: 'Role', specialty: 'Specialty', photo: 'Photo (image link)', employeeId: 'Employee ID', email: 'Internal email (shown on the card only)', hiredAt: 'Hire date (YYYY-MM-DD)', catchphrase: 'Catchphrase', signature: 'Signature' };

export function CardSection({ state, a, st, act, photo }: { state: SwarmState; a: Agent; st?: CardStatsIn; act: Act; photo: ReactNode }) {
  const designs = useDesigns(state);
  const as = state.swarm.agents[a.id]!;
  const shown = core.cardIdentity(a, as);
  const [fields, setFields] = useState<Record<string, string>>(() => ({ ...as.identity }));
  const dirty = core.IDENTITY_FIELDS.some((k) => (fields[k] ?? '') !== (as.identity[k] ?? ''));
  return (
    <section className="fx-stack">
      <h3 className="sw-wave">ID card</h3>
      <div className="sw-designer">
        <div className="fx-stack">
          <AgentIdCard state={state} a={a} st={st} designs={designs} photo={photo} />
          <label className="fx-stack">
            <span className="fx-muted">Card design</span>
            <select className="fx-input" value={as.card} onChange={(e) => void act({ action: 'card', agent: a.id, design: e.target.value })}>
              <option value="">Default design</option>
              {designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </div>
        <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); void act({ action: 'identity', agent: a.id, fields }); }}>
          {core.IDENTITY_FIELDS.map((k) => (
            <label key={k} className="fx-stack">
              <span className="fx-muted">{ID_LABELS[k] ?? k}</span>
              <input className="fx-input" type={k === 'hiredAt' ? 'date' : 'text'} value={fields[k] ?? ''} placeholder={(shown as Record<string, string>)[k] || (k === 'employeeId' ? 'made from the agent id' : k === 'email' ? `${a.id}@agents.axf` : '')} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />
            </label>
          ))}
          <p className="fx-muted">Blank fields use the roster's value. The email is an identity inside the console only; no real mailbox.</p>
          <div className="sw-bar"><Button type="submit" tone="primary" disabled={!dirty}>Save card details</Button></div>
        </form>
      </div>
    </section>
  );
}
