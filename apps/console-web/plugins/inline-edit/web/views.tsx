/**
 * The edit dialog's three views of one element's tokens:
 *   tree     the target's tokens in collapsible groups (Text, Colour, Layout, Shape, Icons, Motion, Hover, Click…)
 *   classic  a classic tree of the element and every parent, root first; each node opens to its tokens, picking a node
 *            makes it the edit target (a parent = parent scope)
 *   grid     one row per token (value, axHub value, source), each row expands to its editor and the details
 * Every token shows the value it inherits from axHub and where that comes from; an override set on this target has a
 * Revert to axHub button that removes only that one override.
 */
import { Fragment, useState } from 'react';
import { Button, Chip, Icon, IconButton } from '@console/axf/react';
import type { ElementNode, ElementTokens, Scope, TokenRow, TokenValue } from './api';
import { TokenEditor, shown, swatchVar } from './editors';

export interface ViewProps {
  data: ElementTokens;
  /** the path the edits go to: the element (item scope) or the chosen parent (parent scope) */
  target: string;
  scope: Scope;
  /** values being typed, not saved yet (live preview) */
  pending: Record<string, TokenValue>;
  onEdit: (token: string, value: TokenValue) => void;
  onRevert: (row: TokenRow) => void;
  onTarget: (path: string) => void;
}

/** Is this row overridden by a record at exactly this target and scope (so Revert applies here)? */
export const ownOverride = (row: TokenRow, target: string, scope: Scope) => row.overridden && row.source.layer === 'inline' && row.source.path === target && row.source.scope === scope;
export const nodeOf = (data: ElementTokens, path: string): ElementNode | undefined => data.chain.find((n) => n.path === path) ?? data.chain.at(-1);

function Swatch({ row, v }: { row: TokenRow; v: TokenValue }) {
  if (row.kind !== 'color' || typeof v !== 'string' || v === 'theme') return null;
  return <span className="axp-inline-edit__swatch axp-inline-edit__swatch--small" style={{ background: swatchVar(v) }} aria-hidden="true" />;
}

/** "axHub: accent · skin parts" — the inherited value and its layer. */
export function Inherited({ row }: { row: TokenRow }) {
  return (
    <span className="axp-inline-edit__inherited" title={row.axHubSource.where}>
      axHub: <Swatch row={row} v={row.axHubValue} /><code>{shown(row.axHubValue)}</code> · {row.axHubSource.layer}
    </span>
  );
}

function OverrideChip({ row, target, scope }: { row: TokenRow; target: string; scope: Scope }) {
  if (!row.overridden) return null;
  if (ownOverride(row, target, scope)) return <Chip tone="warning">overrides axHub</Chip>;
  return <span className="axp-inline-edit__from" title={row.source.path}><Icon name="chevron-up" size={11} /> set on {row.overriddenAt ?? row.source.path} ({row.source.scope})</span>;
}

function Revert({ row, target, scope, onRevert }: { row: TokenRow; target: string; scope: Scope; onRevert: (r: TokenRow) => void }) {
  const own = ownOverride(row, target, scope);
  if (!own) return null;
  return <Button size="sm" tone="ghost" icon="undo" title={`Remove this override: back to ${shown(row.axHubValue)} from axHub`} onClick={() => onRevert(row)}>Revert to axHub</Button>;
}

const groupsOf = (rows: TokenRow[]) => {
  const m = new Map<string, TokenRow[]>();
  for (const r of rows) m.set(r.group, [...(m.get(r.group) ?? []), r]);
  return [...m.entries()];
};

/* ---------------------------------------------------------------- tree */

export function TreeView(p: ViewProps) {
  const node = nodeOf(p.data, p.target);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  if (!node) return null;
  return (
    <ul className="axp-inline-edit__tree" role="tree" aria-label={`Tokens of ${node.label}`}>
      {groupsOf(node.tokens).map(([group, rows]) => {
        const open = !closed[group];
        const changed = rows.filter((r) => r.overridden).length;
        return (
          <li key={group} role="treeitem" aria-expanded={open} className="axp-inline-edit__group">
            <div className="axp-inline-edit__group-head">
              <IconButton icon={open ? 'chevron-down' : 'chevron-right'} label={`${open ? 'Fold' : 'Open'} ${group}`} onClick={() => setClosed((c) => ({ ...c, [group]: open }))} />
              <strong>{group}</strong> <span className="fx-muted">{rows.length} tokens{changed ? ` · ${changed} overridden` : ''}</span>
            </div>
            {open && (
              <ul role="group" className="axp-inline-edit__rows">
                {rows.map((r) => (
                  <li key={r.token} role="treeitem" className={`axp-inline-edit__row ${r.overridden ? 'is-active' : ''}`} data-token={r.token}>
                    <TokenEditor row={r} value={r.token in p.pending ? p.pending[r.token]! : r.value} onChange={(v) => p.onEdit(r.token, v)} />
                    <div className="axp-inline-edit__meta"><Inherited row={r} /><OverrideChip row={r} target={p.target} scope={p.scope} /><Revert row={r} target={p.target} scope={p.scope} onRevert={p.onRevert} /></div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- classic tree */

export function ClassicTreeView(p: ViewProps) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [p.target]: true }));
  const [editing, setEditing] = useState('');
  const chain = p.data.chain;
  const render = (i: number): React.ReactNode => {
    const n = chain[i];
    if (!n) return null;
    const isOpen = !!open[n.path];
    const isTarget = n.path === p.target;
    const changed = n.tokens.filter((t) => t.overridden).length;
    return (
      <li role="treeitem" aria-expanded={isOpen} aria-selected={isTarget} className={`axp-inline-edit__cnode ${isTarget ? 'is-selected' : ''}`}>
        <div className="axp-inline-edit__cnode-head">
          <IconButton icon={isOpen ? 'chevron-down' : 'chevron-right'} label={`${isOpen ? 'Fold' : 'Open'} ${n.label}`} onClick={() => setOpen((o) => ({ ...o, [n.path]: !isOpen }))} />
          <Icon name={i === chain.length - 1 ? 'edit' : 'folder'} size={13} />
          <span className="axp-inline-edit__cnode-label">{n.label}</span> <span className="fx-muted">{n.role}{changed ? ` · ${changed} overridden` : ''}</span>
          {!isTarget && <Button size="sm" tone="quiet" onClick={() => { p.onTarget(n.path); setOpen((o) => ({ ...o, [n.path]: true })); }}>Edit here</Button>}
        </div>
        {isOpen && (
          <ul role="group" className="axp-inline-edit__ctokens">
            {n.tokens.map((r) => {
              const key = `${n.path}#${r.token}`;
              return (
                <li key={r.token} role="treeitem" className={`axp-inline-edit__ctoken ${r.overridden ? 'is-active' : ''}`}>
                  <Button size="sm" tone="quiet" className="axp-inline-edit__ctoken-line" aria-expanded={editing === key} onClick={() => { if (!isTarget) p.onTarget(n.path); setEditing(editing === key ? '' : key); }}>
                    <span>{r.label}</span> <Swatch row={r} v={r.value} /><code>{shown(isTarget && r.token in p.pending ? p.pending[r.token]! : r.value)}</code>
                  </Button>
                  <Inherited row={r} />
                  {editing === key && isTarget && (
                    <div className="axp-inline-edit__cedit">
                      <TokenEditor row={r} value={r.token in p.pending ? p.pending[r.token]! : r.value} onChange={(v) => p.onEdit(r.token, v)} />
                      <OverrideChip row={r} target={p.target} scope={p.scope} />
                      <Revert row={r} target={p.target} scope={p.scope} onRevert={p.onRevert} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {i < chain.length - 1 && <ul role="group" className="axp-inline-edit__cchildren">{render(i + 1)}</ul>}
      </li>
    );
  };
  return <ul className="axp-inline-edit__classic" role="tree" aria-label="The element and its parents">{render(0)}</ul>;
}

/* ---------------------------------------------------------------- grid with expandable rows */

export function GridView(p: ViewProps) {
  const node = nodeOf(p.data, p.target);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!node) return null;
  return (
    <table className="axp-inline-edit__grid">
      <thead><tr><th aria-label="Expand" /><th>Token</th><th>Group</th><th>Value</th><th>axHub value</th><th>From</th></tr></thead>
      <tbody>
        {node.tokens.map((r) => {
          const isOpen = !!open[r.token];
          const v = r.token in p.pending ? p.pending[r.token]! : r.value;
          return (
            <Fragment key={r.token}>
              <tr className={`axp-inline-edit__grow ${r.overridden ? 'is-active' : ''}`} aria-expanded={isOpen} data-token={r.token}>
                <td><IconButton icon={isOpen ? 'chevron-down' : 'chevron-right'} label={`${isOpen ? 'Fold' : 'Open'} ${r.label}`} onClick={() => setOpen((o) => ({ ...o, [r.token]: !isOpen }))} /></td>
                <td>{r.label}</td>
                <td className="fx-muted">{r.group}</td>
                <td><Swatch row={r} v={v} /><code>{shown(v)}</code></td>
                <td><Swatch row={r} v={r.axHubValue} /><code>{shown(r.axHubValue)}</code></td>
                <td>{r.overridden ? <OverrideChip row={r} target={p.target} scope={p.scope} /> : <span className="fx-muted">{r.source.layer}</span>}</td>
              </tr>
              {isOpen && (
                <tr className="axp-inline-edit__gdetail">
                  <td />
                  <td colSpan={5}>
                    <TokenEditor row={r} value={v} onChange={(x) => p.onEdit(r.token, x)} />
                    <div className="axp-inline-edit__meta">
                      <span className="fx-muted">{r.axHubSource.where}</span>
                      <Revert row={r} target={p.target} scope={p.scope} onRevert={p.onRevert} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
