import { useState } from 'react';
import { Button, Icon, IconButton } from '@console/axf/react';
import { EmptyState } from '@console/emptyState';
import * as core from './review-core.mjs';
import type { Item } from './review-core.mjs';
import type { GroupBy } from './keys';
import { Shot, ShotBrowser } from './shots';
import { Detail, GroupPick, Meta, Pick, StatusChip, useReview } from './ui';

/** Waiting / total for a list (group heads, tree nodes). */
const tally = (xs: Item[]) => core.counts(xs)[''] ?? { waiting: 0, total: 0 };

/* The five views. Every one shows the same filtered, sorted items, with checkboxes for the bulk bar. */

/** One collapsible row: checkbox · chevron · status · title · meta; opens to the item's Detail. */
function Row({ it, kind = true }: { it: Item; kind?: boolean }) {
  const r = useReview(); const isOpen = r.open.includes(it.id);
  const first = (r.device ? it.shots.find((s) => s.device === r.device) : null) ?? it.shots[0];
  return (
    <div role="listitem" className={`axp-ui-review__item ${isOpen ? 'is-open' : ''} ${r.sel.includes(it.id) ? 'is-sel' : ''}`}>
      <div className="axp-ui-review__row">
        <Pick id={it.id} label={it.title} />
        <button type="button" data-fx-row className="axp-ui-review__hit" aria-expanded={isOpen} onClick={() => r.toggleOpen(it.id)}>
          <Icon name="chevron-down" size={14} className={isOpen ? '' : 'fx-rot--90'} />
          {first && <Shot src={first.src} alt="" className="axp-ui-review__mini" />}
          <span className="axp-ui-review__title">
            <b>{it.title}</b>
            <Meta it={it} kind={kind} />
          </span>
          <StatusChip status={it.status} />
        </button>
      </div>
      {isOpen && <Detail it={it} />}
    </div>
  );
}

/** Collapsible grid with expandable panes. */
export function GridView({ items }: { items: Item[] }) {
  return <div className="axp-ui-review__grid" role="list">{items.map((it) => <Row key={it.id} it={it} />)}</div>;
}

/** Grid with sub-grids: rows grouped by kind / app / status / build, each group its own collapsible grid. */
export function GroupsView({ items, by }: { items: Item[]; by: GroupBy }) {
  const r = useReview();
  const groups = core.groupItems(items, by, r.kinds);
  const [closed, setClosed] = useState<string[]>([]);
  return (
    <div className="fx-stack axp-ui-review__groups">
      {groups.map((g) => {
        const shut = closed.includes(g.id); const c = tally(g.items);
        return (
          <section key={g.id} className="axp-ui-review__group">
            <div className="axp-ui-review__ghead">
              <GroupPick ids={g.items.map((x) => x.id)} label={g.label} />
              <button type="button" data-fx-row className="axp-ui-review__hit" aria-expanded={!shut} onClick={() => setClosed((o) => (shut ? o.filter((x) => x !== g.id) : [...o, g.id]))}>
                <Icon name="chevron-down" size={14} className={shut ? 'fx-rot--90' : ''} />
                <b>{g.label}</b>
                <span className="fx-small fx-muted">{c.waiting} waiting · {c.total}</span>
              </button>
            </div>
            {!shut && <div className="axp-ui-review__grid" role="list">{g.items.map((it) => <Row key={it.id} it={it} kind={by !== 'kind'} />)}</div>}
          </section>
        );
      })}
    </div>
  );
}

/** Collapsible tree: kind › app › item, checkboxes at every level. */
export function TreeView({ items }: { items: Item[] }) {
  const r = useReview();
  const [shut, setShut] = useState<string[]>([]);
  const flip = (k: string) => setShut((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
  const node = (k: string, label: string, ids: string[], waiting: number, depth: number, icon?: string) => (
    <div className={`axp-ui-review__node is-d${depth}`}>
      <GroupPick ids={ids} label={label} />
      <button type="button" data-fx-row className="axp-ui-review__hit" aria-expanded={!shut.includes(k)} onClick={() => flip(k)}>
        <Icon name="chevron-down" size={14} className={shut.includes(k) ? 'fx-rot--90' : ''} />
        {icon && <Icon name={icon} size={14} />}
        <b>{label}</b>
        <span className="fx-small fx-muted">{waiting} waiting · {ids.length}</span>
      </button>
    </div>
  );
  return (
    <div className="axp-ui-review__tree" role="tree">
      {core.tree(items, r.kinds).map((k) => {
        const kk = `k:${k.id}`; const kind = r.kinds.find((x) => x.id === k.id);
        return (
          <div key={kk} role="treeitem" aria-expanded={!shut.includes(kk)}>
            {node(kk, k.label, k.items.map((x) => x.id), tally(k.items).waiting, 0, kind?.icon)}
            {!shut.includes(kk) && k.apps.map((a) => {
              const ak = `${kk}/${a.id}`;
              return (
                <div key={ak} role="group">
                  {node(ak, a.label, a.items.map((x) => x.id), tally(a.items).waiting, 1)}
                  {!shut.includes(ak) && <div className="axp-ui-review__leaves" role="list">{a.items.map((it) => <Row key={it.id} it={it} kind={false} />)}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Gallery of large shots: a card per item; tapping one opens it across the full width. */
export function GalleryView({ items }: { items: Item[] }) {
  const r = useReview();
  return (
    <div className="axp-ui-review__gallery" role="list">
      {items.map((it) => {
        const isOpen = r.open.includes(it.id);
        const first = (r.device ? it.shots.find((s) => s.device === r.device) : null) ?? it.shots.find((s) => s.device === 'phone') ?? it.shots[0];
        return (
          <div key={it.id} role="listitem" className={`axp-ui-review__card ${isOpen ? 'is-open' : ''} ${r.sel.includes(it.id) ? 'is-sel' : ''}`}>
            {isOpen ? (
              <>
                <div className="axp-ui-review__row">
                  <Pick id={it.id} label={it.title} />
                  <button type="button" data-fx-row className="axp-ui-review__hit" aria-expanded onClick={() => r.toggleOpen(it.id)}>
                    <Icon name="chevron-down" size={14} /><span className="axp-ui-review__title"><b>{it.title}</b><Meta it={it} /></span><StatusChip status={it.status} />
                  </button>
                </div>
                <Detail it={it} />
              </>
            ) : (
              <>
                <button type="button" data-fx-row className="axp-ui-review__cardhit" aria-expanded={false} onClick={() => r.toggleOpen(it.id)}>
                  <span className={`axp-ui-review__cardimg is-${first?.device ?? 'phone'}`}>{first ? <Shot src={first.src} alt={`${it.title} · ${first.name}`} className="axp-ui-review__big" /> : <Icon name="eye" size={20} />}</span>
                  <span className="axp-ui-review__cardtitle"><b>{it.title}</b><Meta it={it} /></span>
                </button>
                <div className="axp-ui-review__cardfoot"><Pick id={it.id} label={it.title} /><StatusChip status={it.status} /></div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Side-by-side compare: the selected items (or, with fewer than two selected, the first two shown) in columns, one
 * screen index for all of them so previous / next move every column together. Phone: columns scroll sideways.
 */
export function CompareView({ items }: { items: Item[] }) {
  const r = useReview();
  const chosen = items.filter((it) => r.sel.includes(it.id));
  const cols = (chosen.length >= 2 ? chosen : items.slice(0, 2)).slice(0, 4);
  const [i, setI] = useState(0);
  if (cols.length < 2) return <EmptyState icon="copy">Compare needs two items. Tick two or more in any view.</EmptyState>;
  const shotsOf = (it: Item) => { const s = r.device ? it.shots.filter((x) => x.device === r.device) : it.shots; return s.length ? s : it.shots; };
  const n = Math.max(...cols.map((it) => shotsOf(it).length), 1);
  const go = (d: number) => setI((x) => (x + d + n) % n);
  return (
    <div className="fx-stack axp-ui-review__compare">
      <div className="axp-ui-review__pbar">
        <IconButton icon="chevron-left" label="Previous screen in every column" onClick={() => go(-1)} />
        <IconButton icon="chevron-right" label="Next screen in every column" onClick={() => go(1)} />
        <span className="fx-small fx-muted">{chosen.length >= 2 ? `${cols.length} selected` : 'First two shown: tick items to choose'} · screen {i + 1} / {n}</span>
      </div>
      <div className="axp-ui-review__cols" style={{ ['--cols' as string]: String(cols.length) }}>
        {cols.map((it) => (
          <div key={it.id} className="axp-ui-review__col">
            <div className="axp-ui-review__row">
              <Pick id={it.id} label={it.title} />
              <span className="axp-ui-review__title"><b>{it.title}</b><Meta it={it} /></span>
              <StatusChip status={it.status} />
            </div>
            <ShotBrowser shots={shotsOf(it)} title={it.title} index={i % Math.max(1, shotsOf(it).length)} onIndex={setI} list={false} />
            <div className="axp-ui-review__acts">
              <Button size="sm" tone="primary" icon="check" onClick={() => void r.decide([it.id], 'approve')}>Approve</Button>
              <Button size="sm" icon="edit" onClick={() => void r.decide([it.id], 'changes')}>Changes</Button>
              <Button size="sm" tone="danger" icon="x" onClick={() => void r.decide([it.id], 'reject')}>Reject</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
