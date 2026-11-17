/*
 * Claude link tab — the Terminal's pinned first tab (can't be closed): the console's connection to Claude and axHub,
 * live and read-only. Each row: time, a kind chip, source, account / model and the summary; tap it for the detail.
 * A chip says whether the stream is connected and whether axHub answers. The toolbar (claudeLinkToolbar.tsx) pauses,
 * filters and clears; scrolling up pauses by itself and a "N new" button jumps back to the newest.
 * Control@1 address: view:terminal/tab:claude-link (deep link ?view=terminal&tab=claude-link).
 * Framework controls and theme tokens only (axp-cl prefix).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Chip, ControlScope, Icon } from '@console/axf/react';
import { KIND_LABEL, KIND_TONE, markSeen, pause, resume, setDefaults, toggleOpen, useClaudeLink, visible, type LinkEvent } from './claude-link';
import { getSettings, onSettings, type Settings } from './api';
import { ClaudeLinkToolbar, LINK_ADDRESS } from './claudeLinkToolbar';

const P = 'axp-cl';
const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const who = (e: LinkEvent) => [e.account, e.model].filter(Boolean).join(' · ');

export function ClaudeLinkTab({ active }: { active: boolean }) {
  const st = useClaudeLink();
  const rows = visible(st);
  const list = useRef<HTMLDivElement>(null);
  const byScroll = useRef(false); // paused because the list was scrolled up (scrolling back down resumes)
  const atEnd = () => { const el = list.current; return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 24; };
  const jump = () => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; byScroll.current = false; resume(); markSeen(); };

  // the Claude link settings (Settings → Plugins → Terminal → Claude link tab): ring size and detail shown by default
  useEffect(() => {
    const apply = (x: Settings) => setDefaults({ max: x.claudeLinkBuffer, detailDefault: !!x.claudeLinkDetail });
    void getSettings().then(apply, () => undefined);
    return onSettings(apply);
  }, []);
  // live: follow the newest unless paused
  useLayoutEffect(() => { if (active && !st.view.paused && list.current) list.current.scrollTop = list.current.scrollHeight; }, [rows.length, active, st.view.paused]);
  useEffect(() => { if (active && !st.view.paused) markSeen(); }, [active, st.view.paused]);
  const onScroll = () => {
    if (!atEnd() && !st.view.paused) { byScroll.current = true; pause(); }
    else if (atEnd() && st.view.paused && byScroll.current) { byScroll.current = false; resume(); }
  };

  const conn = st.conn === 'live' ? { tone: 'success' as const, text: 'Live' } : st.conn === 'connecting' ? { tone: 'warning' as const, text: 'Connecting…' } : { tone: 'danger' as const, text: 'Disconnected: reconnecting' };
  const hub = st.hub === null ? null : st.hub ? { tone: 'success' as const, text: 'axHub answers' } : { tone: 'danger' as const, text: 'axHub unreachable' };
  return (
    <div className={P} hidden={!active} aria-label="Claude link">
      <ControlScope address={LINK_ADDRESS}>
      <ClaudeLinkToolbar status={<>
        <span title={st.conn === 'live' ? 'The live stream is connected' : 'The stream dropped; it reconnects by itself and resumes after the last line'} data-axf-target="panel:status"><Chip tone={conn.tone}>{conn.text}</Chip></span>
        {hub && <span title={st.hubWhy}><Chip tone={hub.tone}>{hub.text}</Chip></span>}
      </>} />
      <div ref={list} className={`${P}__list`} role="log" aria-live={st.view.paused ? 'off' : 'polite'} aria-label="Claude link events" onScroll={onScroll}>
        {rows.length === 0 && (
          <div className={`${P}__empty`}>
            <Icon name="sparkles" size={18} />
            <span>{st.items.length ? 'No event matches the filter.' : st.conn === 'live' ? 'Nothing yet. Launches, account picks, MCP and axHub calls show here as they happen.' : 'Connecting to the console…'}</span>
          </div>
        )}
        {rows.map((e) => {
          const open = st.open.has(e.id) !== st.detailDefault;
          const hasDetail = Object.keys(e.detail ?? {}).length > 0;
          return (
            <div key={e.id} className={`${P}__row is-${e.level}`}>
              <button type="button" data-fx-row data-axf-target={`button:event-${e.id}`} className={`${P}__line`} aria-expanded={hasDetail ? open : undefined} disabled={!hasDetail} onClick={() => toggleOpen(e.id)}
                title={hasDetail ? (open ? 'Hide the detail' : 'Show the detail') : undefined}>
                <span className={`${P}__time`}>{time(e.ts)}</span>
                <span className={`${P}__kind`}><Chip tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind] ?? e.kind}</Chip></span>
                <span className={`${P}__source`}>{e.source}</span>
                {who(e) && <span className={`${P}__who`}>{who(e)}</span>}
                <span className={`${P}__summary`}>{e.session && <span className={`${P}__session`}>{e.session}</span>}{e.summary}</span>
                {hasDetail && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />}
              </button>
              {open && hasDetail && <pre className={`${P}__detail`}>{JSON.stringify(e.detail, null, 2)}</pre>}
            </div>
          );
        })}
      </div>
      {st.view.paused && st.unseen > 0 && (
        <button type="button" className={`fx-btn fx-btn--primary ${P}__jump`} onClick={jump} data-axf-target="button:jump">
          <Icon name="chevron-down" size={13} /> {st.unseen} new
        </button>
      )}
      </ControlScope>
    </div>
  );
}
