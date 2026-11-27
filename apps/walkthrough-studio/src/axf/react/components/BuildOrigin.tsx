/*
 * What Brett said that started a build (build-origin@1, framework/core/build-origin.mjs). Brett, Nov 3 2026 (voice):
 * "All the build entries, like wherever it shows a build in the build manager, pending, all that, I need it to show the
 * prompt, what I said, the verbatim prompt that kicked it off, that initiated it."
 *
 * <BuildOrigin origin={b.origin} />  the quote block at the top of an expanded build row: his words in a speech bubble
 *                                    (when, where, a link to the session), the brief collapsed below, then the addenda.
 * originSubtitle(b.origin)            the first line of what he said, for a collapsed row's subtitle.
 * Theme tokens and framework classes only (fx-chip, fx-btn); nothing here sets a colour or size of its own.
 */
import { useState } from 'react';
import { Icon } from './Icon';
import { Button } from './Controls';
import { normOrigin, subtitle, searchText, type BuildOrigin as Origin } from '../../core/build-origin.mjs';

const SOURCE_ICON: Record<string, string> = { voice: 'mic', chat: 'keyboard', console: 'monitor', code: 'terminal' };
const SOURCE_LABEL: Record<string, string> = { voice: 'Voice', chat: 'Chat', console: 'Console', code: 'Claude Code' };

/** "2026-11-03T14:05:00Z" → "Nov 3 2026, 2:05 PM" (date only when there is no time). */
export function originWhen(at: string): string {
  if (!at) return '';
  const d = new Date(at.length === 10 ? `${at}T12:00:00Z` : at);
  if (Number.isNaN(d.getTime())) return at;
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).replace(',', '');
  return at.length === 10 ? day : `${day}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
export const originSubtitle = (origin: unknown, max?: number): string => subtitle(origin, max);
export const originSearch = (origin: unknown): string => searchText(origin);

function Said({ text, at, source, link, note }: { text: string; at: string; source: string; link?: string; note?: string }) {
  const when = originWhen(at);
  return (
    <figure className="axf-origin__said">
      <blockquote className="axf-origin__bubble">{text}</blockquote>
      <figcaption className="axf-origin__meta">
        {source ? <span className="fx-chip" title={`Said by ${SOURCE_LABEL[source] ?? source}`}><Icon name={SOURCE_ICON[source] ?? 'user'} size={12} />{SOURCE_LABEL[source] ?? source}</span> : null}
        {when ? <time dateTime={at}>{when}</time> : null}
        {link ? <a className="axf-origin__link" href={link} target="_blank" rel="noreferrer"><Icon name="external" size={12} />Session</a> : null}
        {note ? <span className="fx-chip fx-chip--warning" title="Taken from older text afterwards: may not be his exact words">{note}</span> : null}
      </figcaption>
    </figure>
  );
}

/** The "What Brett said" block. Nothing when the build has no origin, unless `showEmpty` (then a one-line "not recorded"). */
export function BuildOrigin({ origin, showEmpty = false, briefOpen = false }: { origin?: unknown; showEmpty?: boolean; briefOpen?: boolean }) {
  const o: Origin | null = normOrigin(origin);
  const [open, setOpen] = useState(briefOpen);
  if (!o) return showEmpty ? <section className="axf-origin axf-origin--empty" aria-label="What Brett said"><span className="axf-origin__label">What Brett said</span><span className="axf-origin__none">Not recorded for this build.</span></section> : null;
  const note = o.said && !o.verbatim ? `From the ${o.from || 'brief'}, may be paraphrased` : '';
  return (
    <section className="axf-origin" aria-label="What Brett said" data-axf-origin={o.verbatim ? 'verbatim' : 'backfilled'}>
      <span className="axf-origin__label"><Icon name="mic" size={12} />What Brett said</span>
      {o.said ? <Said text={o.said} at={o.at} source={o.source} link={o.link} note={note} /> : <span className="axf-origin__none">His words were not recorded; the brief is below.</span>}
      {o.by || o.session ? <span className="axf-origin__by">{o.by ? `Launched by ${o.by}` : ''}{o.by && o.session ? ' · ' : ''}{o.session ? `session ${o.session}` : ''}</span> : null}
      {o.brief ? (
        <div className="axf-origin__brief">
          <Button tone="ghost" size="sm" icon={open ? 'chevron-down' : 'chevron-right'} aria-expanded={open} onClick={() => setOpen(!open)}>
            Brief ({o.brief.length.toLocaleString()} characters)
          </Button>
          {open ? <pre className="axf-origin__brief-text">{o.brief}</pre> : null}
        </div>
      ) : null}
      {o.addenda.length ? (
        <ol className="axf-origin__addenda" aria-label="Later changes Brett asked for">
          {o.addenda.map((a, i) => (
            <li key={`${a.at}|${i}`}><span className="axf-origin__label">Addendum {i + 1}</span><Said text={a.said} at={a.at} source={a.source} note={a.verbatim ? '' : 'May be paraphrased'} /></li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
