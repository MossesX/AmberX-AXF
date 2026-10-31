/** The expanded row of the session browser: what the run is, where it ran, its files. */
import type { ReactNode } from 'react';
import { fmtDuration, fmtTokens, fmtUsd, fmtWhen, KIND_LABEL, type Kind, type Run } from './core';

export function Line({ k, children }: { k: string; children: ReactNode }) {
  return <div className="axp-session-history__line"><span className="fx-small fx-muted axp-session-history__k">{k}</span><span className="fx-grow">{children}</span></div>;
}

export function RunFacts({ run: r }: { run: Run }) {
  const t = r.tokens ?? {};
  return (
    <div className="fx-stack axp-session-history__facts">
      <Line k="Id"><span className="fx-mono fx-small">{r.id}</span> <span className="fx-small fx-muted">· {KIND_LABEL[r.kind as Kind] ?? r.kind}</span></Line>
      {r.cwd ? <Line k="Where"><span className="fx-mono fx-small">{r.cwd}</span>{r.branch ? <span className="fx-small fx-muted"> · {r.branch}</span> : null}</Line> : null}
      <Line k="When"><span className="fx-small">{fmtWhen(r.startedAt)} → {fmtWhen(r.lastAt)} · {fmtDuration(r.durationMs)} · {r.turns} turns · {r.tools} tool calls</span></Line>
      <Line k="Tokens"><span className="fx-small">{fmtTokens(t.input)} in · {fmtTokens(t.output)} out · {fmtTokens(t.cacheRead)} cache read · {fmtTokens((t.cacheWrite ?? 0) + (t.cacheWrite1h ?? 0))} cache write</span></Line>
      <Line k="Cost"><span className="fx-small">{fmtUsd(r.usd)}{r.costFrom === 'result' ? ' (exact, from the run’s result)' : r.costFrom === 'usage' ? ' (from every turn’s usage)' : r.costFrom === 'report' ? ' (from the agent report)' : ''}</span></Line>
      {r.budget ? <Line k="Budget"><span className="fx-small">{[r.budget.usd != null ? fmtUsd(r.budget.usd) : '', r.budget.tokens != null ? `${fmtTokens(r.budget.tokens)} tokens` : '', r.budget.turns != null ? `${r.budget.turns} turns` : ''].filter(Boolean).join(' · ')}</span></Line> : null}
    </div>
  );
}

export function RunDetail({ run }: { run: Run }) {
  return <RunFacts run={run} />;
}
