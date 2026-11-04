import { useState } from 'react';
import { Button, SelectField, TextField, useRuntime } from '@console/axf/react';
import * as pc from './plan-core.mjs';
import { savePlan, useStudio, VIEW } from './api';
import { openPlan } from './ui';

/** Quick capture (banner +, Builds ▸ New plan…, search, right-click): a title, a line, a category, a template. Parked unless changed. */
export function CaptureDialog({ close, text }: { close?: () => void; text?: string }) {
  const rt = useRuntime();
  const { state } = useStudio();
  const [title, setTitle] = useState(text ?? '');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('parked');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<{ id: string; title: string }[]>([]);
  const all = state?.templates.all ?? pc.BUILT_IN_TEMPLATES;
  const build = () => { const t = all.find((x) => x.id === template); const fields = { title: title.trim(), summary, category, status }; return t ? pc.fromTemplate(t, fields) : pc.normalize(fields); };
  const save = async (force = false, edit = false) => {
    setBusy(true);
    try {
      const r = await savePlan(build(), { note: 'Quick capture', force });
      if (!r.ok && r.duplicates?.length) { setDups(r.duplicates); return; }
      rt.toast(`Saved ${r.plan.title} (${r.plan.status})`, 'success');
      close?.();
      if (edit) { openPlan({ id: r.plan.id }); rt.navigate(VIEW); }
    } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  return (
    <form className="fx-stack axp-plan-studio__capture" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <TextField label="Plan" value={title} onChange={setTitle} required autoFocus placeholder="What should be planned?" />
      <TextField label="One line about it" value={summary} onChange={setSummary} rows={2} />
      <SelectField label="Category" value={category} empty="Uncategorized" onChange={setCategory} options={(state?.categories.paths ?? []).map((p) => ({ value: p, label: p }))} />
      <SelectField label="Status" value={status} onChange={setStatus} options={pc.STATUSES.map((s) => ({ value: s.id, label: s.label }))} />
      <SelectField label="Template" value={template} empty="None" onChange={setTemplate} options={all.map((t) => ({ value: t.id, label: t.label }))} />
      {dups.length > 0 && <p className="fx-error" role="alert">Looks like {dups.map((d) => d.title).join(', ')}. <Button size="sm" tone="quiet" onClick={() => void save(true)}>Save anyway</Button></p>}
      <div className="fx-row">
        <Button tone="primary" icon="save" type="submit" busy={busy} disabled={!title.trim()}>Save</Button>
        <Button icon="edit" busy={busy} disabled={!title.trim()} onClick={() => void save(false, true)}>Save and open</Button>
      </div>
    </form>
  );
}
