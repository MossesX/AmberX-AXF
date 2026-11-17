/*
 * The Claude link tab's toolbar (role="toolbar", settings id terminal.claude-link): Pause / Resume auto-scroll, the
 * kind filter (multi-select chips), a text filter and Clear (clears the view; the log is kept). Every control carries
 * its control@1 address (data-axf-target) and runs the same store calls as the actions claude-link.pause / resume /
 * filter / clear, the MCP tools console-terminal_claude_link_*, `axf claude-link …` and voice.
 */
import type { ReactNode } from 'react';
import { Button, TextField } from '@console/axf/react';
import { KINDS, KIND_LABEL, clear, pause, resume, setView, toggleKind, useClaudeLink } from './claude-link';

export const TOOLBAR_ID = 'terminal.claude-link';
const T = 'view:terminal/tab:claude-link';

export function ClaudeLinkToolbar({ status }: { status?: ReactNode }) {
  const st = useClaudeLink();
  const v = st.view;
  return (
    <div className="axp-cl__bar" role="toolbar" aria-label="Claude link" data-axf-toolbar={TOOLBAR_ID}>
      <Button size="sm" icon={v.paused ? 'play' : 'pause'} tone={v.paused ? 'primary' : 'neutral'} onClick={() => (v.paused ? resume() : pause())}
        aria-pressed={v.paused} title={v.paused ? 'Resume: follow new events' : 'Pause: stop following new events (scrolling up pauses too)'} data-axf-target={`${T}/action:${v.paused ? 'resume' : 'pause'}`}>
        {v.paused ? 'Resume' : 'Pause'}
      </Button>
      <span className="axp-cl__kinds" role="group" aria-label="Kinds shown" data-axf-target={`${T}/filter:kinds`}>
        {KINDS.map((k) => (
          <button key={k} type="button" className={`fx-chip ${v.kinds.includes(k) ? 'fx-chip--accent' : ''}`} aria-pressed={v.kinds.includes(k)}
            title={v.kinds.includes(k) ? `Stop filtering on ${KIND_LABEL[k]}` : `Show ${KIND_LABEL[k]} events (none picked = all)`} onClick={() => toggleKind(k)}
            data-axf-target={`${T}/filter:kinds=${k}`}>
            {KIND_LABEL[k]}{st.items.length ? ` ${st.items.filter((e) => e.kind === k).length}` : ''}
          </button>
        ))}
        {v.kinds.length > 0 && <button type="button" className="fx-chip" onClick={() => setView({ kinds: [] })} title="Show every kind" data-axf-target={`${T}/filter:kinds=all`}>All</button>}
      </span>
      <span className="axp-cl__q" data-axf-target={`${T}/filter:q`}>
        <TextField label="Filter" value={v.q} onChange={(q) => setView({ q })} placeholder="tool, session, account…" />
      </span>
      <span className="fx-grow" />
      {status}
      <Button size="sm" icon="trash" confirm="Clear the Claude link view? The log itself is kept (GET claude-link?all=1)." onClick={() => void clear()} data-axf-target={`${T}/action:clear`}>Clear</Button>
    </div>
  );
}
