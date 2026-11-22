import { useState } from 'react';
import { Button, Checkbox, SelectField, TextField } from '@console/axf/react';
import { PRIORITIES, PRIORITY_LABEL } from '@console/axf/core/build-priority.mjs';
import { parallelChoices, requestBody } from './orchestrator-core.mjs';

/*
 * Ask for a build (Pending tab): files a build with the orchestrator through POST pipeline/request, the one way in for
 * every build. "Split into" is the per-build parallel override (Nov 13 2026: "split into N parallel"): Split settings
 * decide (default), one build, or split into 2-12 parallel builds; it beats the Split settings for this build only.
 * Same anywhere: MCP pipeline-request {parallel}, `pipeline.mjs request --title T --parallel 3`, or say "build me …,
 * split into 3 parallel". The id open in `#orch-file-build` is the deep link build-orchestrator.file-build.
 */
export const FILE_BUILD_ID = 'orch-file-build';
const PRIORITY_OPTIONS = [{ value: '', label: 'Default' }, ...PRIORITIES.map((p) => ({ value: p, label: (PRIORITY_LABEL as Record<string, string>)[p] ?? p }))];

/** Opens the filing form if it is on the page; returns it (for flashWhenReady). */
export function openFileBuild(): HTMLDetailsElement | null {
  const el = document.getElementById(FILE_BUILD_ID) as HTMLDetailsElement | null;
  if (el) el.open = true;
  return el;
}

export function FileBuildForm({ busy, onFile }: { busy: boolean; onFile: (body: ReturnType<typeof requestBody>, what: string) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [said, setSaid] = useState('');
  const [detail, setDetail] = useState('');
  const [priority, setPriority] = useState('');
  const [parallel, setParallel] = useState('default');
  const [queue, setQueue] = useState(true);
  const choices = parallelChoices();
  const submit = async () => {
    const body = requestBody({ title, said, detail, priority, parallel, queue });
    if (!body.title) return;
    const split = body.parallel === 'off' ? ', one build' : body.parallel ? `, split into ${body.parallel} parallel` : '';
    if (await onFile(body, `Filed "${body.title}"${split}${body.queue ? '' : ', waits in Pending'}`)) { setTitle(''); setSaid(''); setDetail(''); setPriority(''); setParallel('default'); }
  };
  return (
    <details className="pd-add oc-file-build" id={FILE_BUILD_ID} data-help="file-build">
      <summary>Ask for a build <span className="fx-muted fx-small">· filed with the orchestrator: split, planned, then the dispatcher starts it</span></summary>
      <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <TextField label="Title" value={title} onChange={setTitle} required placeholder="What to build" />
        <TextField label="What Brett said (his exact words)" value={said} onChange={setSaid} rows={2} placeholder="Optional: kept verbatim on the build" />
        <TextField label="Details" value={detail} onChange={setDetail} rows={3} placeholder="Scope, files, acceptance notes" />
        <div className="pd-two">
          <SelectField label="Split into" value={parallel} options={choices} onChange={setParallel}
            hint="Parallel builds run at the same time in separate slots: a shared contract step first, an integration step last. Beats the Split settings for this build." />
          <SelectField label="Priority" value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
        </div>
        <Checkbox label="Starts by itself when its turn comes (off = waits in Pending)" checked={queue} onChange={setQueue} />
        <div><Button tone="primary" icon="plus" type="submit" disabled={busy || !title.trim()}>File the build</Button></div>
      </form>
    </details>
  );
}
