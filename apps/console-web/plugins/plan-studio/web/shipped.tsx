import type { ReactNode } from 'react';
import { Chip, Icon, Markdown } from '@console/axf/react';
import type { Manifest } from '@console/axf/core/shipped-manifest.mjs';
import * as pc from './plan-core.mjs';
import type { Plan } from './plan-core.mjs';
import { fmtWhen } from './api';

/*
 * The Shipped section of a plan: the shipped-manifest@1 the orchestrator sent when the build landed, every field.
 * Brett's words come first and highlighted (a paraphrase is marked as such); then the brief, steps with estimate vs
 * actual, models / accounts / runs, branch / PR / commits, files by area, tests, UI Review, cost and tokens, the report
 * and what is still open. A refused manifest shows as a flag with the field errors; the last valid manifest stays.
 */

const GITHUB = 'https://github.com/MossesX/AmberX-AXF';
const n = (v: number) => v.toLocaleString();
const money = (v: number) => (v ? `$${v >= 100 ? Math.round(v) : v.toFixed(2)}` : '$0');
const sha = (s: string) => s.slice(0, 9);

/** One line for the plan rows and cards: landed · PR · cost. */
export function shippedLine(p: Plan): string {
  const m = p.shipped;
  if (!m) return p.shippedProblem ? 'shipped manifest refused' : '';
  return ['shipped', m.landedCommit ? `landed ${sha(m.landedCommit)}` : '', m.pr?.number ? `PR #${m.pr.number}` : '', p.actual?.usd ? `${money(p.actual.usd)} actual` : ''].filter(Boolean).join(' · ');
}

function Sec({ title, count, open, children }: { title: string; count?: string | number; open?: boolean; children: ReactNode }) {
  return (
    <details className="axp-plan-studio__shsec" open={open}>
      <summary><Icon name="chevron-right" size={11} />{title}{count !== undefined && count !== '' && <span className="axp-plan-studio__n">{count}</span>}</summary>
      <div className="axp-plan-studio__shbody">{children}</div>
    </details>
  );
}

export function ShippedPanel({ plan }: { plan: Plan }) {
  const m = plan.shipped as Manifest | null | undefined;
  const bad = plan.shippedProblem;
  return (
    <div className="axp-plan-studio__ship">
      {bad && (
        <div className="axp-plan-studio__shflag" role="alert">
          <p><Icon name="alert" size={12} /> <b>Shipped manifest refused</b> {fmtWhen(bad.at)}{bad.source ? ` · ${bad.source}` : ''}{bad.id ? ` · ${bad.id}${bad.rev ? ` rev ${bad.rev}` : ''}` : ''}. It is not a valid shipped-manifest@1, so the plan {m ? 'keeps its last valid manifest' : 'has no manifest'}.</p>
          <ul>{bad.errors.map((e, i) => <li key={i}><span className="fx-mono">{e.field}</span> {e.message}</li>)}</ul>
        </div>
      )}
      {!m && !bad && <p className="fx-muted axp-plan-studio__hint">No shipped manifest yet: the orchestrator sends one when the build lands (Shipped features gets the same one).</p>}
      {m && <ManifestView m={m} plan={plan} />}
    </div>
  );
}

function ManifestView({ m, plan }: { m: Manifest; plan: Plan }) {
  const done = m.steps.filter((s) => s.done);
  const est = m.steps.reduce((a, s) => a + s.estimateMin, 0);
  const act = done.reduce((a, s) => a + s.actualMin, 0);
  const tests = { pass: m.tests.filter((t) => t.result === 'pass').length, fail: m.tests.filter((t) => t.result === 'fail').length };
  const tok = m.cost.tokens;
  const landed = m.landedCommit || m.mergedAt || m.landedAt;
  return (
    <>
      <div className="axp-plan-studio__shhead">
        <Chip tone={landed ? 'success' : 'warning'}>{landed ? 'Landed' : 'Not landed'}</Chip>
        {m.landedCommit && <a className="fx-mono" href={`${GITHUB}/commit/${m.landedCommit}`} target="_blank" rel="noreferrer" title="The commit that brought it onto main">{sha(m.landedCommit)}</a>}
        {m.pr.number > 0 && <a href={m.pr.url || `${GITHUB}/pull/${m.pr.number}`} target="_blank" rel="noreferrer">PR #{m.pr.number}</a>}
        {m.branch && <span className="fx-mono axp-plan-studio__shbranch">{m.branch}</span>}
        <span className="axp-plan-studio__grow" />
        <span className="fx-muted axp-plan-studio__n">{m.id} rev {m.rev} · {m.source}{m.by ? ` · ${m.by}` : ''} · {fmtWhen(m.shippedAt)}</span>
      </div>

      <blockquote className={`axp-plan-studio__said${m.said.verbatim ? '' : ' is-paraphrase'}`}>
        <p className="axp-plan-studio__saidh"><Icon name="mic" size={12} /> <b>Brett said</b>{m.said.at && <span className="fx-muted"> · {fmtWhen(m.said.at)}</span>}{m.said.source && <span className="fx-muted"> · {m.said.source}</span>} <Chip tone={m.said.verbatim ? 'accent' : 'warning'}>{m.said.verbatim ? 'verbatim' : 'not verbatim: from the build detail'}</Chip></p>
        <p className="axp-plan-studio__saidtext">{m.said.text}</p>
        {m.said.addenda.map((a, i) => <p key={i} className="axp-plan-studio__saidadd"><b>Later{a.at ? ` (${fmtWhen(a.at)})` : ''}:</b> {a.text}{!a.verbatim && <Chip tone="warning">not verbatim</Chip>}</p>)}
      </blockquote>

      <div className="axp-plan-studio__strip" aria-label="Shipped totals">
        <span><b>{done.length}/{m.steps.length}</b> steps</span>
        <span><b>{pc.fmtMinutes(est) || '0 min'}</b> estimated</span>
        <span><b>{pc.fmtMinutes(act) || '0 min'}</b> actual</span>
        <span><b>{m.files.length}</b> files</span>
        <span><b>{tests.pass}</b> tests pass{tests.fail ? <>, <b className="fx-error">{tests.fail}</b> fail</> : ''}</span>
        <span><b>{money(m.cost.usd)}</b>{m.cost.estimated ? ' est.' : ''} cost</span>
        <span><b>{m.open.length}</b> open</span>
      </div>

      <Sec title="Brief the session ran on" count={m.brief ? `${n(m.brief.length)} chars` : 'none'}>
        {m.brief ? <div className="axp-plan-studio__preview"><Markdown text={m.brief} /></div> : <p className="fx-muted">The manifest carries no brief.</p>}
      </Sec>

      <Sec title="Steps: estimate vs actual" count={m.steps.length} open>
        <ol className="axp-plan-studio__shsteps">
          {m.steps.map((s) => (
            <li key={s.id} className={s.done ? 'is-done' : ''}>
              <span className="axp-plan-studio__sid">{s.id}</span>
              <span className="axp-plan-studio__shstext">{s.text}</span>
              <span className="axp-plan-studio__shsmeta">
                <Chip>{s.model}</Chip>
                <span title="Estimate">{s.estimate || (s.estimateMin ? pc.fmtMinutes(s.estimateMin) : '–')}</span>
                <span title="Actual">→ {s.done ? (pc.fmtMinutes(s.actualMin) || '< 1 min') : 'open'}</span>
                {s.doneAt && <span className="fx-muted">{fmtWhen(s.doneAt)}</span>}
              </span>
            </li>
          ))}
        </ol>
      </Sec>

      <Sec title="Models, accounts and runs" count={`${m.models.join(', ') || 'no model'} · ${m.accounts.join(', ') || 'no account'}`}>
        {m.runs.length ? (
          <ul className="axp-plan-studio__shlist">
            {m.runs.map((r) => <li key={r.session}><span className="fx-mono">{r.session}</span> <Chip>{r.model || '?'}</Chip> <span>{r.account}</span> <span className="fx-muted">{fmtWhen(r.startedAt)}{r.endedAt ? ` → ${fmtWhen(r.endedAt)}` : ''}</span> <span>{money(r.costUsd)}</span>{r.exit !== null && r.exit !== 0 && <Chip tone="danger">exit {r.exit}</Chip>}</li>)}
          </ul>
        ) : <p className="fx-muted">No headless runs recorded.</p>}
      </Sec>

      <Sec title="Branch, PR and commits" count={m.commits.length}>
        <p>Branch <span className="fx-mono">{m.branch || '–'}</span>{m.pr.number > 0 && <> · <a href={m.pr.url || `${GITHUB}/pull/${m.pr.number}`} target="_blank" rel="noreferrer">PR #{m.pr.number}</a> ({m.pr.repo})</>}{m.mergedAt && <> · merged {fmtWhen(m.mergedAt)}</>}{m.landedAt && <> · landed {fmtWhen(m.landedAt)}</>}</p>
        {m.landedCommit && <p>Landed as <a className="fx-mono" href={`${GITHUB}/commit/${m.landedCommit}`} target="_blank" rel="noreferrer">{m.landedCommit}</a></p>}
        {m.commits.length > 0 && <ul className="axp-plan-studio__shlist">{m.commits.map((c) => <li key={c}><a className="fx-mono" href={`${GITHUB}/commit/${c}`} target="_blank" rel="noreferrer">{sha(c)}</a></li>)}</ul>}
      </Sec>

      <Sec title="Files changed, by area" count={m.files.length}>
        {m.areas.length ? m.areas.map((a) => (
          <div key={`${a.kind}:${a.id}`} className="axp-plan-studio__sharea">
            <p><Chip>{a.kind}</Chip> <b>{a.id}</b> <span className="axp-plan-studio__n">{a.files.length}</span></p>
            <ul className="axp-plan-studio__shlist">{a.files.map((f) => <li key={f} className="fx-mono">{f}</li>)}</ul>
          </div>
        )) : <p className="fx-muted">No files recorded.</p>}
      </Sec>

      <Sec title="Tests" count={m.tests.length ? `${tests.pass} pass · ${tests.fail} fail` : 'none'}>
        {m.tests.length ? <ul className="axp-plan-studio__shlist">{m.tests.map((t, i) => <li key={i}><Chip tone={t.result === 'pass' ? 'success' : t.result === 'fail' ? 'danger' : undefined}>{t.result}</Chip> <span>{t.name}</span>{t.command && <span className="fx-mono fx-muted"> {t.command}</span>}{t.detail && <span className="fx-muted"> {t.detail}</span>}</li>)}</ul> : <p className="fx-muted">No test lines in the report.</p>}
      </Sec>

      <Sec title="UI Review" count={m.uiReview.length}>
        {m.uiReview.length ? <ul className="axp-plan-studio__shlist">{m.uiReview.map((r) => <li key={r.id || r.name}><Chip>{r.status || 'waiting'}</Chip> {r.url ? <a href={r.url}>{r.name || r.id}</a> : <span>{r.name || r.id}</span>}{r.group && <span className="fx-muted"> · {r.group}</span>}</li>)}</ul> : <p className="fx-muted">No UI Review items for this build.</p>}
      </Sec>

      <Sec title="Cost and tokens" count={`${money(m.cost.usd)}${m.cost.estimated ? ' est.' : ''}`}>
        <p>{money(m.cost.usd)}{m.cost.estimated ? ' (estimated from tokens)' : ' (metered)'} · plan estimate {pc.fmtCost(plan.cost.usd) || '$0'}</p>
        <p className="fx-muted">input {n(tok.input)} · output {n(tok.output)} · cache read {n(tok.cacheRead)} · cache write {n(tok.cacheWrite)}</p>
      </Sec>

      <Sec title="Report" count={m.report ? 'yes' : 'none'}>
        {m.report ? <p className="fx-mono">{m.report}</p> : <p className="fx-muted">No build report found.</p>}
      </Sec>

      <Sec title="Still open" count={m.open.length} open={m.open.length > 0}>
        {m.open.length ? <ul className="axp-plan-studio__shlist">{m.open.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="fx-muted">Nothing left open.</p>}
      </Sec>
    </>
  );
}
