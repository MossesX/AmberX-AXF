import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AgentAvatar, Button, Switch } from '@console/axf/react';
import * as core from './swarm-core.mjs';
import * as watch from './chat-watch.mjs';
import { KEYS, useSetting } from './chat-settings';
import { fmtTime, type Act, type Agent, type ChatMsg, type SwarmState } from './ui-types';

/*
 * Group chat: one room like a normal conversation. Boss posts every assignment and lease decision, agents post
 * their reports and handoffs, banter comes from the zero-token bank or one cheap batch. A switch turns the room
 * off for everyone (nothing posted, nothing spent), and one per agent. The filter shows only what the crew says about
 * Brett (chat-watch.mjs, same rules as `swarm.mjs mentions` and the hub mirror), with the negative ones marked.
 */

const VIEWS = [{ id: 'all', label: 'Everyone' }, { id: 'brett', label: 'About Brett' }, { id: 'negative', label: 'Negative' }] as const;
type View = (typeof VIEWS)[number]['id'];

export function Bubble({ m, agents, ceiling, flag }: { m: ChatMsg; agents: Map<string, Agent>; ceiling?: number; flag?: watch.Mention }) {
  const a = agents.get(m.from);
  const who = a?.name ?? (m.from === 'boss' ? 'Boss' : m.from === 'brett' ? 'Brett' : m.from);
  return (
    <li className={`sw-msg is-${m.kind} ${m.from === 'brett' ? 'is-mine' : ''} ${flag ? `is-flag is-${flag.tone}` : ''}`} style={ceiling ? ({ '--sw-vibe': core.vibeShade(m.vibe, ceiling) } as CSSProperties) : undefined} title={m.vibe != null ? `vibe ${m.vibe}${m.toned ? ' · toned down' : ''}` : undefined}>
      {a ? <AgentAvatar info={{ id: a.id, name: a.name, role: a.role, avatar: a.avatar }} size="large" /> : <span className={`sw-msg__badge is-${m.from}`} aria-hidden="true">{who.slice(0, 1)}</span>}
      <div className="sw-msg__body">
        <div className="sw-msg__head"><b>{who}</b><span className="fx-muted">{fmtTime(m.at)}{m.kind !== 'banter' && m.kind !== 'brett' ? ` · ${m.kind}` : ''}{flag ? ` · ${flag.tone === 'negative' ? 'negative' : 'mentions'}: ${flag.matched.join(', ')}` : ''}</span></div>
        <p>{flag ? flag.text : m.text}</p>
      </div>
    </li>
  );
}

export function ChatTab({ state, act }: { state: SwarmState; act: Act }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const agents = new Map(state.roster.agents.map((a) => [a.id, a]));
  const [view, setView] = useState<View>('all');
  const flagged = watch.mentions(state.swarm, state.roster, { limit: 500 });
  const flags = new Map(flagged.map((f) => [f.id, f]));
  const counts = { all: state.swarm.messages.length, brett: flagged.length, negative: flagged.filter((f) => f.tone === 'negative').length };
  const msgs = view === 'all' ? state.swarm.messages.slice(-200) : state.swarm.messages.filter((m) => flags.has(m.id) && (view === 'brett' || flags.get(m.id)?.tone === 'negative'));
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, view]);
  const on = state.swarm.chat.enabled;
  const colorBy = useSetting<boolean>(KEYS.colorByVibe, false);
  const base = useSetting<string>(KEYS.vibeColor, 'accent');
  return (
    <div className="fx-stack">
      <div className="sw-bar">
        <Switch label="Group chat" checked={on} onChange={(v) => void act({ action: 'chat', enabled: v })} hint={on ? 'On for every agent below that is switched on.' : 'Off: nothing is posted and no banter is paid for.'} />
      </div>
      <div className="sw-bar" role="group" aria-label="Agents in the chat">
        {state.roster.agents.map((a) => <Switch key={a.id} label={a.name} checked={state.swarm.chat.agents[a.id] !== false} disabled={!on} onChange={(v) => void act({ action: 'chat', agent: a.id, on: v })} />)}
      </div>
      <div className="sw-bar">
        <div className="fx-seg fx-seg--sm" role="tablist" aria-label="Show">
          {VIEWS.map((v) => <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={`fx-seg__opt${view === v.id ? ' is-on' : ''}`} onClick={() => setView(v.id)}>{v.label} ({counts[v.id]})</button>)}
        </div>
        {view !== 'all' && <span className="fx-muted">What the crew says about Brett, the boss or the owner. Secrets are redacted. Sessions read the same list on axHub: data path {watch.HUB_FOLDER}/mentions.json.</span>}
      </div>
      <div className={`sw-room ${colorBy ? `is-vibe is-${base}` : ''}`} data-fx-ctx-target="agent-swarm-chat">
        {msgs.length === 0 ? <p className="fx-empty">{view === 'all' ? 'Quiet in here. Messages show up as Boss hands out jobs.' : view === 'brett' ? 'Nobody is talking about Brett.' : 'Nothing negative about Brett.'}</p>
          : <ul className="sw-msgs">{msgs.map((m) => <Bubble key={m.id} m={m} agents={agents} ceiling={colorBy ? state.swarm.chatSettings.vibe : undefined} flag={view === 'all' ? undefined : flags.get(m.id)} />)}</ul>}
        <div ref={end} />
      </div>
      <form className="sw-bar" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; void act({ action: 'say', text }).then((l) => { if (l) setText(''); }); }}>
        <input className="fx-input sw-grow" aria-label="Message the crew" placeholder={on ? 'Say something to the crew…' : 'The group chat is off'} disabled={!on} value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" icon="play" disabled={!on || !text.trim()}>Send</Button>
      </form>
    </div>
  );
}

/** An agent's own lines, for its profile. */
export function AgentChat({ a, state }: { a: Agent; state: SwarmState }) {
  const mine = state.swarm.messages.filter((m) => m.from === a.id).slice(-30);
  const agents = new Map(state.roster.agents.map((x) => [x.id, x]));
  return mine.length === 0 ? <p className="fx-muted">Hasn't said a word yet.</p> : <ul className="sw-msgs">{mine.map((m) => <Bubble key={m.id} m={m} agents={agents} />)}</ul>;
}
