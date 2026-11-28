/**
 * The Shipped box of a plan (shipped.mjs): the shipped-manifest@1 the plan received when its build shipped, as the
 * orchestrator sent it. Brett's words first, then what landed (commit, PR, branch, when), a totals line and the details
 * (steps estimate vs actual, files, tests, still open). A refused manifest shows as a danger note with every field
 * error; the valid manifest it had before stays below it. Nothing here is read from the builds store.
 */
import { Chip, Note } from '@console/axf/react';
import type { Item, ShippedManifest } from './tree-core.mjs';

const B = 'axp-plan-studio-2';
const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '');

/** A row's mark: shipped (landed) or refused (a manifest was refused), or nothing. */
export function ShippedMark({ item }: { item: Item }) {
  if (item.shippedProblem) return <span title={`Shipped manifest refused: ${item.shippedProblem.reason}`}><Chip tone="danger">refused</Chip></span>;
  if (item.shipped) return <span title={`Shipped: ${item.shipped.id} rev ${item.shipped.rev}`}><Chip tone="success">shipped</Chip></span>;
  return null;
}

export function ShippedPanel({ item }: { item: Item }) {
  const m = item.shipped; const p = item.shippedProblem;
  if (!m && !p) return null;
  return (
    <section className={`${B}__shipped`} aria-label="Shipped" data-axf-target={`plan-studio-2.shipped:${item.id}`}>
      <p className="fx-eyebrow">Shipped</p>
      {p && (
        <Note tone="danger">
          <strong>A shipped manifest for {p.build || 'this build'} was refused</strong> ({when(p.at)}{p.source ? `, from ${p.source}` : ''}{p.rev ? `, rev ${p.rev}` : ''}). It is not valid shipped-manifest@1:
          <ul className={`${B}__shipped-errors`}>{p.errors.map((e) => <li key={`${e.field}:${e.message}`}><code>{e.field}</code> {e.message}</li>)}</ul>
          {m ? 'The plan keeps the valid manifest it received before.' : 'The plan has no shipped manifest until a valid one arrives.'}
        </Note>
      )}
      {m && <Manifest m={m} />}
    </section>
  );
}

function Manifest({ m }: { m: ShippedManifest }) {
  const done = m.steps.filter((s) => s.done);
  const est = m.steps.reduce((a, s) => a + (s.estimateMin || 0), 0);
  const act = done.reduce((a, s) => a + (s.actualMin || 0), 0);
  const pass = m.tests.filter((t) => t.result === 'pass').length; const fail = m.tests.filter((t) => t.result === 'fail').length;
  return (
    <>
      {m.said.text && (
        <blockquote className={`${B}__shipped-said`}>
          <span>{m.said.verbatim ? <Chip tone="accent">Brett, verbatim</Chip> : <Chip tone="warning">paraphrased</Chip>}</span>
          <p>{m.said.text}</p>
        </blockquote>
      )}
      <p className={`${B}__shipped-line`}>
        {m.landedCommit && <span>landed <code>{m.landedCommit.slice(0, 9)}</code></span>}
        {m.pr.number > 0 && (m.pr.url ? <a href={m.pr.url} target="_blank" rel="noopener noreferrer">PR #{m.pr.number}</a> : <span>PR #{m.pr.number}</span>)}
        {m.branch && <code>{m.branch}</code>}
        {(m.landedAt || m.shippedAt) && <span className="fx-muted">{when(m.landedAt || m.shippedAt)}</span>}
        <span className="fx-muted">{m.id} rev {m.rev} · {m.source}</span>
      </p>
      <p className={`${B}__shipped-line fx-muted`}>
        <span>{done.length}/{m.steps.length} steps</span>
        {(est > 0 || act > 0) && <span>{est} min est. · {act} min actual</span>}
        <span>{m.files.length} file{m.files.length === 1 ? '' : 's'}</span>
        {m.tests.length > 0 && <span>{pass} pass{fail ? ` · ${fail} fail` : ''} of {m.tests.length} tests</span>}
        {m.cost.usd > 0 && <span>${m.cost.usd.toFixed(2)}{m.cost.estimated ? ' est.' : ''}</span>}
        {m.models.length > 0 && <span>{m.models.join(', ')}</span>}
        {m.open.length > 0 && <span>{m.open.length} still open</span>}
      </p>
      {m.steps.length > 0 && (
        <details className={`${B}__shipped-more`}>
          <summary>Steps</summary>
          <ul>{m.steps.map((s) => <li key={s.id}>{s.done ? '✓' : '○'} <strong>{s.id}</strong> {s.text} <span className="fx-muted">{s.model}{s.estimate ? ` · ${s.estimate}` : ''}{s.actualMin ? ` · ${s.actualMin} min` : ''}</span></li>)}</ul>
        </details>
      )}
      {m.files.length > 0 && (
        <details className={`${B}__shipped-more`}>
          <summary>Files</summary>
          <ul>{m.files.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </details>
      )}
      {m.tests.length > 0 && (
        <details className={`${B}__shipped-more`}>
          <summary>Tests</summary>
          <ul>{m.tests.map((x) => <li key={`${x.name}:${x.command}`}>{x.result} · {x.name}{x.command ? <> <code>{x.command}</code></> : null}</li>)}</ul>
        </details>
      )}
      {m.open.length > 0 && (
        <details className={`${B}__shipped-more`} open>
          <summary>Still open</summary>
          <ul>{m.open.map((o) => <li key={o}>{o}</li>)}</ul>
        </details>
      )}
      {m.brief && (
        <details className={`${B}__shipped-more`}>
          <summary>Brief</summary>
          <pre className={`${B}__shipped-brief`}>{m.brief}</pre>
        </details>
      )}
    </>
  );
}
