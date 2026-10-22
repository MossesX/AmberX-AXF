/**
 * Manual-fix steps with copy links. A step is plain text that may contain shell commands
 * ("On the VPS: bash …", "sudo ufw allow …", "(docker logs axf-console)"); each command is shown as code with a
 * Copy link next to it. Used by the Systems check ("Fix it manually") and the plugin lifecycle panel.
 */
import { Fragment } from 'react';
import { Icon, useRuntime } from '../axf/react';

const STARTS = 'sudo|bash|sh|node|npx|npm|git|gh|docker|chmod|chown|curl|wget|claude-pick|claude-sync|claude|apt-get|apt|ufw|systemctl|cd|mkdir|cp|mv|python3|pip|uvicorn|[A-Z][A-Z0-9_]*=(?:\\$\\([^)]*\\)|\\S+)';
// A command starts at the beginning, after "label: ", "(" / "(or: ", "then " or "or: ", and runs until "   (" (a note),
// a closing ")", ", ", a sentence end, or the end of the step. $(…) substitutions stay inside the command.
const CMD = new RegExp(`(^|:\\s+|\\(\\s*(?:or:\\s*)?|\\bthen\\s+|\\bor:\\s+)((?:${STARTS})(?=\\s|$)(?:\\$\\([^)]*\\)|[^()])*?)(?=\\s{3}\\(|\\s+\\(|\\)|,\\s|[.;,]?\\s*$|\\.\\s)`, 'g');

export type Part = { kind: 'text' | 'cmd'; value: string };

export function splitCommands(step: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of step.matchAll(CMD)) {
    const lead = m[1] ?? '';
    const cmd = (m[2] ?? '').trim();
    if (!cmd || cmd.split(/\s+/).length < 2) continue; // a bare word ("claude") is prose, not a command
    const start = (m.index ?? 0) + lead.length;
    if (start > last) out.push({ kind: 'text', value: step.slice(last, start) });
    out.push({ kind: 'cmd', value: cmd });
    last = start + (m[2] ?? '').length;
  }
  if (last < step.length) out.push({ kind: 'text', value: step.slice(last) });
  return out;
}

export const commandsIn = (steps: string[]) => steps.flatMap((s) => splitCommands(s).filter((p) => p.kind === 'cmd').map((p) => p.value));

export function useCopy() {
  const rt = useRuntime();
  return (t: string, what = 'Command') => {
    const ok = () => rt.toast(`${what} copied`, 'success');
    const fail = () => rt.toast('Clipboard blocked — long-press the command to copy it', 'warning');
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(t).then(ok, fail);
    else fail();
  };
}

export function CopyLink({ text, label = 'Copy', what }: { text: string; label?: string; what?: string }) {
  const copy = useCopy();
  return <button type="button" className="cl-copy" onClick={() => copy(text, what)} aria-label={`${label}: ${text}`}><Icon name="copy" size={12} />{label}</button>;
}

/** One step: prose stays prose, every command becomes code + a Copy link. */
export function StepText({ text }: { text: string }) {
  return <>{splitCommands(text).map((p, i) => (p.kind === 'cmd'
    ? <span key={i} className="cl-cmd"><code className="cl-cmd__code">{p.value}</code><CopyLink text={p.value} /></span>
    : <Fragment key={i}>{p.value}</Fragment>))}</>;
}

/** A numbered list of steps with copy links, plus "Copy all commands" when there are several. */
export function StepList({ steps, className }: { steps: string[]; className?: string }) {
  const cmds = commandsIn(steps);
  return (
    <>
      <ol className={className}>{steps.map((t) => <li key={t}><StepText text={t} /></li>)}</ol>
      {cmds.length > 1 && <CopyLink text={cmds.join('\n')} label={`Copy all ${cmds.length} commands`} what="Commands" />}
    </>
  );
}
