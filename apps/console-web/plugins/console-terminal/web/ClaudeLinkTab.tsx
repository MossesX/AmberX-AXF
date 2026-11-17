/*
 * Claude link tab — the Terminal's pinned first tab (can't be closed): the console's connection to Claude and axHub,
 * live and read-only. Each row: time, a kind chip, source, account / model and the summary; tap it for the detail.
 * A chip says whether the stream is connected and whether axHub answers. The toolbar (claudeLinkToolbar.tsx) pauses,
 * filters and clears; scrolling up pauses by itself and a "N new" button jumps back to the newest.
 * Control@1 address: view:terminal/tab:claude-link (deep link ?view=terminal&tab=claude-link).
 * Framework controls and theme tokens only (axp-cl prefix).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const [layout, setLayout] = useState<Settings['claudeLinkLayout']>('dense');
  const [picked, setPicked] = useState<number | null>(null); // split layout: the event whose detail shows beside the list
  const byScroll = useRef(false); // paused because the list was scrolled up (scrolling back down resumes)
  const atEnd = () => { const el = list.current; return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 24; };
  const jump = () => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; byScroll.current = false; resume(); markSeen(); };

  // the Claude link settings (Settings → Plugins → Terminal → Claude link tab): ring size and detail shown by default
  useEffect(() => {
    const apply = (x: Settings) => { setDefaults({ max: x.claudeLinkBuffer, detailDefault: !!x.claudeLinkDetail }); setLayout(x.claudeLinkLayout ?? 'dense'); };
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

  const pickedEv = layout === 'split' ? rows.find((e) => e.id === picked) ?? rows[rows.length - 1] ?? null : null;
  const conn = st.conn === 'live' ? { tone: 'success' as const, text: 'Live' } : st.conn === 'connecting' ? { tone: 'warning' as const, text: 'Connecting…' } : { tone: 'danger' as const, text: 'Disconnected: reconnecting' };
  const hub = st.hub === null ? null : st.hub ? { tone: 'success' as const, text: 'axHub answers' } : { tone: 'danger' as const, text: 'axHub unreachable' };
  return (
    <div className={`${P} ${P}--${layout}`} hidden={!active} aria-label="Claude link">
      <ControlScope address={LINK_ADDRESS}>
      <ClaudeLinkToolbar status={<>
        <span title={st.conn === 'live' ? 'The live stream is connected' : 'The stream dropped; it reconnects by itself and resumes after the last line'} data-axf-target="panel:status"><Chip tone={conn.tone}>{conn.text}</Chip></span>
        {hub && <span title={st.hubWhy}><Chip tone={hub.tone}>{hub.text}</Chip></span>}
      </>} />
      <div className={`${P}__body`}>
      <div ref={list} className={`${P}__list`} role="log" aria-live={st.view.paused ? 'off' : 'polite'} aria-label="Claude link events" onScroll={onScroll}>
        {rows.length === 0 && (
          <div className={`${P}__empty`}>
            <Icon name="sparkles" size={18} />
            <span>{st.items.length ? 'No event matches the filter.' : st.conn === 'live' ? 'Nothing yet. Launches, account picks, MCP and axHub calls show here as they happen.' : 'Connecting to the console…'}</span>
          </div>
        )}
        {rows.map((e) => {
          const split = layout === 'split';
          const open = !split && st.open.has(e.id) !== st.detailDefault;
          const hasDetail = Object.keys(e.detail ?? {}).length > 0;
          return (
            <div key={e.id} className={`${P}__row is-${e.level} ${split && pickedEv?.id === e.id ? 'is-picked' : ''}`}>
              <button type="button" data-fx-row data-axf-target={`button:event-${e.id}`} className={`${P}__line ${!hasDetail && !split ? 'is-plain' : ''}`} aria-expanded={hasDetail && !split ? open : undefined} aria-pressed={split ? pickedEv?.id === e.id : undefined} onClick={() => (split ? setPicked(e.id) : hasDetail ? toggleOpen(e.id) : undefined)}
                title={hasDetail ? (open ? 'Hide the detail' : 'Show the detail') : undefined}>
                <span className={`${P}__time`}>{time(e.ts)}</span>
                <span className={`${P}__kind`}><Chip tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind] ?? e.kind}</Chip></span>
                <span className={`${P}__source`}>{e.source}</span>
                {who(e) && <span className={`${P}__who`}>{who(e)}</span>}
                {e.session && <span className={`${P}__session`}>{e.session}</span>}
                <span className={`${P}__summary`}>{e.summary}</span>
                {hasDetail && !split && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />}
              </button>
              {open && hasDetail && <pre className={`${P}__detail`}>{JSON.stringify(e.detail, null, 2)}</pre>}
            </div>
          );
        })}
      </div>
      {layout === 'split' && (
        <aside className={`${P}__side`} aria-label="Event detail" data-axf-target="panel:detail">
          {pickedEv ? <>
            <div className={`${P}__side-head`}><Chip tone={KIND_TONE[pickedEv.kind]}>{KIND_LABEL[pickedEv.kind] ?? pickedEv.kind}</Chip><span className={`${P}__time`}>{new Date(pickedEv.ts).toLocaleString()}</span></div>
            <p className={`${P}__summary`}>{pickedEv.summary}</p>
            <dl className={`${P}__facts`}>
              {([['Source', pickedEv.source], ['Session', pickedEv.session], ['Account', pickedEv.account], ['Model', pickedEv.model], ['Level', pickedEv.level]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
            {Object.keys(pickedEv.detail ?? {}).length > 0 && <pre className={`${P}__detail`}>{JSON.stringify(pickedEv.detail, null, 2)}</pre>}
          </> : <div className={`${P}__empty`}>Pick an event to see its detail.</div>}
        </aside>
      )}
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
