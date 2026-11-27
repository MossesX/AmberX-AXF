/**
 * The Rules tab toolbar (role="toolbar", settings id gate.rules): Reset to defaults (asks first, then the server's own
 * two-step confirm, POST rules/reset) and Check a PR (opens the gate.check-pr dialog, GET check?pr=). The same routes
 * the CLI (`axf gate rules reset`, `axf gate check <pr>`) and MCP (gate_rules_reset, gate_check_pr) call.
 */
import { useState } from 'react';
import { Button, TextField, useRuntime } from '@console/axf/react';
import { confirmed, type RuleSet } from './api';
import { CHECK_PR_DIALOG } from './CheckPrDialog';

export function RulesToolbar({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const rt = useRuntime();
  const [pr, setPr] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try { const r = await confirmed<{ rules: RuleSet }>('rules/reset', { by: 'console', reason: 'Reset to defaults from the Rules tab' }); rt.toast(`Every rule is back to its default (rev ${r.rules.rev}).`, 'success', 'Gate rules'); await onChanged(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Gate rules'); } finally { setBusy(false); }
  };
  const check = () => { const n = pr.replace(/^#/, '').trim(); if (/^\d+$/.test(n)) rt.openDialog(CHECK_PR_DIALOG, { pr: n }); else rt.toast('Type a PR number first.', 'warning', 'Check a PR'); };
  return (
    <div className="axp-gate__bar" role="toolbar" aria-label="Gate rules" data-axf-toolbar="gate.rules">
      <TextField label="PR" value={pr} onChange={setPr} placeholder="705" />
      <Button icon="search" onClick={check}>Check a PR</Button>
      <span className="axp-gate__bar-end">
        <Button tone="danger" icon="undo" busy={busy} confirm="Reset every gate rule to its default? Your changes to the rules are replaced (History keeps them)." onClick={() => void reset()}>Reset to defaults</Button>
      </span>
    </div>
  );
}
