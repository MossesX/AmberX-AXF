/*
 * Chat log pieces for any AXF web app (harvested Nov 4 2026 from the console's Chat viewer, so there is one chat
 * renderer): <ChatLog> (the transcript column, newest at the bottom), <ChatBubble> (one message with avatar, name and
 * time; Brett's on the right), <ChatSystemLine> (a centred status line) and <BuildChatLog>, which tells a build or a
 * codebase change as a conversation (build-chat@1, framework/core/build-chat.mjs).
 *
 * Brett, Nov 4 2026 (on Codebase changes): "This needs to be displayed like the chat log."
 * Styled by `.fx-chat*` in framework/ui/axf.css: theme tokens only, so a theme or scale swap restyles every bubble.
 */
import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Button } from './Controls';
import { Markdown } from './Markdown';
import { AgentAvatar } from './AgentAvatar';
import { originWhen } from './BuildOrigin';
import { timeline, tookText, type ChatInput, type ChatMessage, type ChatRole } from '../../core/build-chat.mjs';

/** The transcript column (`role="log"`). */
export function ChatLog({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`fx-chat ${className}`} role="log" aria-label={label}>{children}</div>;
}

export interface ChatBubbleProps {
  /** brett = right-aligned accent bubble; amber / agent = left; tool = muted */
  role: ChatRole | 'user' | 'assistant';
  /** the name over the text */
  who: ReactNode;
  /** a face: an <AgentAvatar>, or an icon name for a plain round avatar */
  avatar?: ReactNode | string;
  at?: string;
  /** the time as shown (default: "Nov 4 2026, 9:53 PM") */
  atLabel?: string;
  /** extra bits after the name (a mic icon, a state chip) */
  tags?: ReactNode;
  id?: string;
  active?: boolean;
  className?: string;
  children: ReactNode;
}

const side = (role: ChatBubbleProps['role']) => (role === 'brett' || role === 'user' ? 'brett' : role === 'assistant' ? 'amber' : role);

export function ChatBubble({ role, who, avatar, at, atLabel, tags, id, active, className = '', children }: ChatBubbleProps) {
  const face = typeof avatar === 'string' ? <span className="fx-chat__face" aria-hidden="true"><Icon name={avatar} size={14} /></span> : avatar;
  return (
    <div id={id} className={`fx-chat__msg is-${side(role)}${active ? ' is-active' : ''} ${className}`}>
      {face ? <span className="fx-chat__avatar">{face}</span> : null}
      <div className="fx-chat__bubble">
        <span className="fx-chat__who">{who}{tags}{at ? <time dateTime={at}>{atLabel ?? originWhen(at)}</time> : null}</span>
        <div className="fx-chat__body">{children}</div>
      </div>
    </div>
  );
}

/** A centred status line between bubbles: "Started · Nov 4, 9:53 PM". */
export function ChatSystemLine({ icon = 'info', at, children }: { icon?: string; at?: string; children: ReactNode }) {
  return (
    <div className="fx-chat__system" role="note">
      <Icon name={icon} size={12} /><span>{children}</span>{at ? <time dateTime={at}>{originWhen(at)}</time> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- a build as a chat log */

const STATE_LABEL: Record<string, string> = { queued: 'Queued', running: 'In progress', done: 'Done', failed: 'Failed', skipped: 'Skipped', partial: 'Partly done', cancelled: 'Cancelled' };
const STATE_ICON: Record<string, string> = { queued: 'clock', running: 'refresh', done: 'check-circle', failed: 'x-circle', skipped: 'minus', partial: 'alert', cancelled: 'minus' };
const STATE_TONE: Record<string, string> = { done: 'success', failed: 'danger', partial: 'warning', running: 'accent' };
const SYSTEM_ICON: Record<string, string> = { started: 'play', queued: 'clock', paused: 'pause', merged: 'check-circle', deployed: 'upload', closed: 'x', status: 'info' };

function StateChip({ state }: { state: string }) {
  const tone = STATE_TONE[state];
  return <span className={`fx-chip fx-chat__state${tone ? ` fx-chip--${tone}` : ''}`}><Icon name={STATE_ICON[state] ?? 'info'} size={11} />{STATE_LABEL[state] ?? state}</span>;
}

export interface BuildChatLogProps {
  input: ChatInput;
  /** the named agent that did the work (avatar + name on its bubbles); default "Agent" */
  agent?: string;
  /** a repo (owner/name) to link commits */
  repo?: string;
  /** how many lines of the brief show before "Show full brief" (default 6) */
  briefLines?: number;
  label?: string;
}

function BriefBubble({ m, lines }: { m: ChatMessage; lines: number }) {
  const [full, setFull] = useState(false);
  const [rules, setRules] = useState(false);
  const long = m.text.split('\n').length > lines || m.text.length > lines * 90;
  return (
    <ChatBubble role="amber" who="Amber" avatar="sparkles" at={m.at}>
      {m.text ? (
        <div className={`fx-chat__brief${long && !full ? ' is-clamped' : ''}`}>
          <Markdown text={m.text} compact />
        </div>
      ) : null}
      <span className="fx-chat__acts">
        {long ? <Button size="sm" tone="ghost" icon={full ? 'chevron-up' : 'chevron-down'} aria-expanded={full} onClick={() => setFull(!full)}>{full ? 'Show less' : 'Show full brief'}</Button> : null}
        {m.rules?.length ? <Button size="sm" tone="ghost" icon="shield" aria-expanded={rules} onClick={() => setRules(!rules)}>Session rules ({m.rules.length})</Button> : null}
      </span>
      {rules && m.rules?.length ? (
        <ul className="fx-chat__rules" aria-label="Session rules">
          {m.rules.map((r) => <li key={r.title}><Markdown text={r.text} compact /></li>)}
        </ul>
      ) : null}
    </ChatBubble>
  );
}

function sha(repo: string | undefined, s: string) {
  return repo ? <a href={`https://github.com/${repo}/commit/${s}`} target="_blank" rel="noopener noreferrer"><code>{s.slice(0, 7)}</code></a> : <code>{s.slice(0, 7)}</code>;
}
function prHref(pr: string, repo?: string): string | undefined {
  if (/^https:\/\//.test(pr)) return pr;
  const n = /^#?(\d+)$/.exec(pr)?.[1];
  return n && repo ? `https://github.com/${repo}/pull/${n}` : undefined;
}

function AgentMessage({ m, agent, repo }: { m: ChatMessage; agent?: string; repo?: string }) {
  const face = agent ? <AgentAvatar agent={agent} size="small" /> : 'terminal';
  const who = agent || 'Agent';
  if (m.kind === 'step') {
    const took = tookText(m.took);
    return (
      <ChatBubble role="agent" who={who} avatar={face} at={m.at || undefined} tags={<StateChip state={m.state ?? 'queued'} />} className={`is-step is-${m.state}`}>
        <p className="fx-chat__text">{m.text}</p>
        {took || m.checks || m.model ? <span className="fx-chat__meta">{[took && `took ${took}`, m.checks ? `${m.checks} check${m.checks === 1 ? '' : 's'}` : '', m.model].filter(Boolean).join(' · ')}</span> : null}
        {m.note ? <span className="fx-chat__meta">{m.note}</span> : null}
      </ChatBubble>
    );
  }
  if (m.kind === 'commits') {
    return (
      <ChatBubble role="agent" who={who} avatar={face} at={m.at || undefined}>
        <p className="fx-chat__text">{m.commits?.length} commit{m.commits?.length === 1 ? '' : 's'}{m.branch ? <> on <Icon name="branch" size={11} /> {m.branch}</> : null}</p>
        <ul className="fx-chat__list">{m.commits?.map((c) => <li key={c.sha}>{sha(repo, c.sha)}{c.message ? ` ${c.message}` : ''}</li>)}</ul>
      </ChatBubble>
    );
  }
  if (m.kind === 'pr') {
    const href = prHref(m.text, repo);
    return (
      <ChatBubble role="agent" who={who} avatar={face} at={m.at || undefined}>
        <p className="fx-chat__text">Opened a pull request: {href ? <a href={href} target="_blank" rel="noopener noreferrer">{m.text.replace(/^https:\/\/github\.com\//, '')}</a> : m.text}</p>
      </ChatBubble>
    );
  }
  // result
  const tests = m.tests ? Object.entries(m.tests) : [];
  return (
    <ChatBubble role="agent" who={who} avatar={face} at={m.at || undefined} tags={<StateChip state={m.state ?? 'done'} />} className="is-result">
      {m.text ? <Markdown text={m.text} compact /> : <p className="fx-chat__text">Finished.</p>}
      {tests.length ? <span className="fx-chat__meta">{tests.filter(([, t]) => t.state === 'pass').length} of {tests.length} checks passed</span> : null}
    </ChatBubble>
  );
}

/** A build or a codebase change as a conversation: Brett's words, Amber's brief, the agent's steps, status lines. */
export function BuildChatLog({ input, agent, repo, briefLines = 6, label = 'Build chat log' }: BuildChatLogProps) {
  const msgs = timeline(input);
  if (!msgs.length) return <p className="fx-small fx-muted">Nothing recorded yet.</p>;
  return (
    <ChatLog label={label} className="fx-chat--build">
      {msgs.map((m) => {
        if (m.role === 'brett') {
          return (
            <ChatBubble key={m.id} role="brett" who="Brett" avatar="user" at={m.at || undefined}
              tags={m.kind === 'addendum' ? <span className="fx-chip">Addendum</span> : !m.verbatim ? <span className="fx-chip fx-chip--warning" title="Taken from older text: may not be his exact words">may be paraphrased</span> : null}>
              <p className="fx-chat__text">{m.text}</p>
              {m.link ? <a className="fx-chat__meta" href={m.link} target="_blank" rel="noreferrer"><Icon name="external" size={11} /> Session</a> : null}
            </ChatBubble>
          );
        }
        if (m.role === 'amber') return <BriefBubble key={m.id} m={m} lines={briefLines} />;
        if (m.role === 'agent') return <AgentMessage key={m.id} m={m} agent={agent} repo={repo} />;
        return <ChatSystemLine key={m.id} icon={SYSTEM_ICON[m.kind] ?? 'info'} at={m.at || undefined}>{m.text}</ChatSystemLine>;
      })}
    </ChatLog>
  );
}
