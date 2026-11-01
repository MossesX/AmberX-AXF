import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Switch } from '@console/axf/react';
import * as core from './swarm-core.mjs';
import { Avatar } from './cards';
import { KEYS, useSetting } from './chat-settings';
import { fmtTime, type Act, type Agent, type ChatMsg, type SwarmState } from './ui-types';

/*
 * Group chat: one room like a normal conversation. Boss posts every assignment and lease decision, agents post
 * their reports and handoffs, banter comes from the zero-token bank or one cheap batch. A switch turns the room
 * off for everyone (nothing posted, nothing spent), and one per agent.
 */

export function Bubble({ m, agents, ceiling }: { m: ChatMsg; agents: Map<string, Agent>; ceiling?: number }) {
  const a = agents.get(m.from);
  const who = a?.name ?? (m.from === 'boss' ? 'Boss' : m.from === 'brett' ? 'Brett' : m.from);
  return (
    <li className={`sw-msg is-${m.kind} ${m.from === 'brett' ? 'is-mine' : ''}`} style={ceiling ? ({ '--sw-vibe': core.vibeShade(m.vibe, ceiling) } as CSSProperties) : undefined} title={m.vibe != null ? `vibe ${m.vibe}${m.toned ? ' · toned down' : ''}` : undefined}>
      {a ? <Avatar a={a} size={32} /> : <span className={`sw-msg__badge is-${m.from}`} aria-hidden="true">{who.slice(0, 1)}</span>}
      <div className="sw-msg__body">
        <div className="sw-msg__head"><b>{who}</b><span className="fx-muted">{fmtTime(m.at)}{m.kind !== 'banter' && m.kind !== 'brett' ? ` · ${m.kind}` : ''}</span></div>
        <p>{m.text}</p>
      </div>
    </li>
  );
}

export function ChatTab({ state, act }: { state: SwarmState; act: Act }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const agents = new Map(state.roster.agents.map((a) => [a.id, a]));
  const msgs = state.swarm.messages.slice(-200);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
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
      <div className={`sw-room ${colorBy ? `is-vibe is-${base}` : ''}`} data-fx-ctx-target="agent-swarm-chat">
        {msgs.length === 0 ? <p className="fx-empty">Quiet in here. Messages show up as Boss hands out jobs.</p>
          : <ul className="sw-msgs">{msgs.map((m) => <Bubble key={m.id} m={m} agents={agents} ceiling={colorBy ? state.swarm.chatSettings.vibe : undefined} />)}</ul>}
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
