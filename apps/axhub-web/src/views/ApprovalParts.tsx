/**
 * The three layers of an approval (axHub decision #99): what is being approved (the title), what it does (the
 * caller's description + the tool's own), and the exact code that runs, in its own collapsible section. The title and
 * description are the caller's claim; the code is what the approval binds to, so it is always one tap away.
 */
import { Chip, Container, Note } from '../axf/react';
import { relTime, sourceKind, sourceWho, SOURCE_LABEL } from '../hub/core';
import { EFFECT_LABEL, EFFECT_TONE, SOURCE_TONE, type ApprovalItem } from '../hub/types';
import { CopyButton } from './hubPage';

/** What it does: the caller's description (labelled as theirs) and the tool's own description. */
export function WhatItDoes({ item }: { item: ApprovalItem }) {
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <Chip tone={EFFECT_TONE[item.effect]}>{EFFECT_LABEL[item.effect]}</Chip>
        <Chip>{item.code.qualified}</Chip>
      </div>
      {item.description ? (
        <div className="fx-stack">
          <p className="fx-eyebrow">What it does ({item.reasonGiven ? "Claude's words" : 'from the hub'})</p>
          <p className="axp-axhub-text">{item.description}</p>
        </div>
      ) : (
        <Note tone="warning" icon="alert">No reason was given for this call. Read the code before you approve it.</Note>
      )}
      {item.toolDescription && (
        <div className="fx-stack">
          <p className="fx-eyebrow">The tool ({item.code.qualified})</p>
          <p className="fx-muted axp-axhub-text">{item.toolDescription}</p>
        </div>
      )}
    </div>
  );
}

/** The exact code that runs, collapsed until opened. */
export function CodeSection({ item, defaultOpen = false }: { item: ApprovalItem; defaultOpen?: boolean }) {
  return (
    <Container title="The code that runs" icon="code" collapsible defaultOpen={defaultOpen}>
      <div className="fx-stack">
        {item.code.command !== undefined && (
          <>
            <p className="fx-eyebrow">Command</p>
            <pre className="fx-mono axp-axhub-call">{item.code.command}</pre>
          </>
        )}
        <p className="fx-eyebrow">{item.code.qualified} with arguments</p>
        <pre className="fx-mono axp-axhub-call">{item.code.arguments}</pre>
        <div className="fx-row fx-row--wrap">
          {item.code.command !== undefined && <CopyButton text={item.code.command} label="Copy the command" />}
          <CopyButton text={item.summary} label="Copy the whole call" />
        </div>
      </div>
    </Container>
  );
}

/**
 * Who asked and what it runs, one line under the title (axHub decision 109): Source badge, the session / build / agent
 * name, the tool as a small chip, when it was asked. The client (e.g. claude-code 2.1.3) is in the badge's tooltip.
 */
export function SourceLine({ item, asked }: { item: ApprovalItem; asked: string }) {
  const kind = sourceKind(item);
  const label = item.source?.label || SOURCE_LABEL[kind]!;
  const who = sourceWho(item);
  const client = [item.source?.client, item.source?.clientVersion].filter(Boolean).join(' ');
  return (
    <div className="fx-row fx-row--wrap axp-axhub-source" data-source={kind}>
      <span title={client ? `${label} · ${client}` : label}><Chip tone={SOURCE_TONE[kind]}>{label}</Chip></span>
      {who && <strong>{who}</strong>}
      <Chip>{item.tool}</Chip>
      <span className="fx-muted" title={item.createdAt}>asked {asked}{item.showExpires ? ` · expires ${relTime(item.expiresAt)}` : ''}</span>
    </div>
  );
}
