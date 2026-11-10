import type { ReactNode } from 'react';
import { Button, Icon } from '@console/axf/react';
import { collapseAll, isSectionCollapsed, setQuery, toggleSection, useViewState } from './view-state';

/** A collapsible section header (Accounts, Pending, Queue, Building): the open / closed state is remembered across reloads. */
export function SectionHead({ id, children }: { id: string; children: ReactNode }) {
  const v = useViewState();
  const closed = isSectionCollapsed(v, id);
  return (
    <h2 className="pd-card__title oc-sechead">
      <button type="button" data-fx-row className="oc-sechead__btn" aria-expanded={!closed} aria-controls={sectionDomId(id)} onClick={() => toggleSection(id)}>
        <Icon name={closed ? 'chevron-right' : 'chevron-down'} size={14} />
        <span className="oc-sechead__label">{children}</span>
      </button>
    </h2>
  );
}
export const sectionDomId = (id: string) => `oc-sec-${id.replace(/[^a-z0-9-]/gi, '-')}`;

/** The page's search bar and Collapse all / Expand all (rows and section headers together). */
export function SearchBar({ count, total }: { count?: number; total?: number }) {
  const v = useViewState();
  return (
    <div className="oc-find" role="toolbar" aria-label="Search and collapse">
      <div className="oc-find__search" role="search">
        <Icon name="search" size={14} />
        <input className="fx-input" type="search" value={v.query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search builds: title, id, branch, account, words…" aria-label="Search the builds by title, id, branch, account and words" />
        {v.query && count != null && <span className="fx-small fx-muted oc-find__n">{count}{total != null ? `/${total}` : ''}</span>}
        {v.query && <button type="button" className="fx-iconbtn" aria-label="Clear the search" onClick={() => setQuery('')}><Icon name="x" size={14} /></button>}
      </div>
      <Button size="sm" tone="neutral" icon="chevron-up" onClick={() => collapseAll('collapse')} title="Fold every row and close every section header">Collapse all</Button>
      <Button size="sm" tone="neutral" icon="chevron-down" onClick={() => collapseAll('expand')} title="Open every row and every section header">Expand all</Button>
    </div>
  );
}
