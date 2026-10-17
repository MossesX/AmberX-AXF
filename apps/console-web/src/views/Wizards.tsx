import { useState } from 'react';
import { Button, Chip, useRuntime } from '../axf/react';
import { useStore } from '../store';
import * as api from '../api';
import type { EngineResult, InstallableLibrary, LibraryParam } from '../api';
import { LIBRARIES, UI_LIBRARIES } from './Libraries';

const now = () => new Date().toISOString();
const Code = ({ children }: { children: string }) => <pre className="fx-code" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{children}</pre>;

/** Mirror a build-engine response (its `log` array + our own line) onto the output terminal. */
function useTerminal(channel: string) {
  const rt = useRuntime();
  return {
    start: (text: string) => { rt.terminal.log(channel, `▶ ${text}`); rt.dispatch(`terminal.open:${channel}`); },
    result: (r: EngineResult, okText: string) => { if (r.log) rt.terminal.many(channel, r.log); if (r.ok) rt.terminal.ok(channel, okText); else rt.terminal.error(channel, r.error ?? 'failed'); },
    recorded: (why: string, script: string) => { rt.terminal.warn(channel, why); rt.terminal.many(channel, script); },
  };
}

/* ------------------------------------------------------------------ */
/* open project                                                         */
/* ------------------------------------------------------------------ */

export function OpenProjectDialog({ close }: { close: () => void }) {
  const s = useStore();
  const rt = useRuntime();
  const [dir, setDir] = useState(s.project || 'apps/');
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>Installs from the library manager and UI-library imports are applied to this project. Paths are relative to the build engine's repo root.</p>
      <label className="fx-field">Project directory<input className="fx-input fx-mono" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="apps/my-app" autoFocus /></label>
      <div className="fx-row fx-row--wrap">{['apps/console-web', 'apps/console', 'apps/demo'].map((p) => <button key={p} className={`fx-chip ${dir === p ? 'is-selected' : ''}`} onClick={() => setDir(p)}>{p}</button>)}</div>
      <div className="fx-row fx-row--end"><Button onClick={close}>Cancel</Button><Button tone="primary" icon="folder" onClick={() => { s.openProject(dir.trim()); rt.toast(`Project: ${dir.trim() || '(none)'}`, 'success'); close(); }}>Open</Button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* build a library (module + demo app)                                  */
/* ------------------------------------------------------------------ */

const DEMO_TEMPLATES = ['list-detail', 'dashboard', 'wizard', 'settings', 'feed', 'editor', 'player', 'map', 'chat', 'profile'];

export function LibraryPickerDialog({ libraryId, close }: { libraryId: string; close: () => void }) {
  const s = useStore();
  const rt = useRuntime();
  const term = useTerminal('build');
  const lib = LIBRARIES.find((l) => l.id === libraryId);
  const [include, setInclude] = useState<Set<string>>(() => new Set(lib?.features.filter((f) => s.isChecked(f) || s.status(f) !== 'built')));
  const [template, setTemplate] = useState(DEMO_TEMPLATES[0]!);
  const [name, setName] = useState(`AXF Demo — ${lib?.label ?? ''}`);
  const [log, setLog] = useState('');
  if (!lib) return <p>Unknown library {libraryId}</p>;
  const items = s.catalog.tabs.flatMap((t) => t.groups.flatMap((g) => g.items));
  const spec = [`# Build library ${lib.packageName} (${lib.module})`, '', `Demo app: apps/demo-${lib.id} — "${name}" — template screen: ${template}`, '', '## Features to implement', ...[...include].map((f) => `- ${f} — ${items.find((i) => i.id === f)?.title ?? f} [${s.status(f)}]`), '', '## Commands', `node framework/cli/axf.mjs new-module ${lib.id} --label "${lib.label}" --capabilities ${[...include].join(',')}`, `node framework/cli/axf.mjs new-demo ${lib.id} --name "${name}"`].join('\n');
  const run = async () => {
    term.start(`build ${lib.packageName} + demo app`);
    const r1 = await api.post('new-module', { name: lib.id, label: lib.label, capabilities: [...include] }); term.result(r1, `module ${lib.packageName} scaffolded`);
    const r2 = r1.ok ? await api.post('new-demo', { library: lib.id, name }) : r1; if (r1.ok) term.result(r2, `demo app apps/demo-${lib.id} created`);
    const ok = r1.ok && r2.ok;
    if (!ok && !s.backend) term.recorded('Build engine offline — recorded; run the copied spec with Claude Code.', spec);
    setLog(ok ? `✓ ${r1.dir ?? lib.packageName}\n✓ ${r2.dir ?? `apps/demo-${lib.id}`}` : `✗ ${r1.error ?? r2.error ?? 'recorded'}`);
    s.addDemo({ id: `demo-${lib.id}`, library: lib.id, name, template, status: ok ? 'scaffolded' : 'planned', createdAt: now() });
    s.addPort({ id: `build-${lib.id}-${Date.now().toString(36)}`, kind: 'build', name: lib.label, source: lib.packageName, project: `apps/demo-${lib.id}`, status: ok ? 'scaffolded' : 'recorded', createdAt: now(), log: ok ? JSON.stringify(r1.log ?? []) : spec });
    rt.toast(ok ? `${lib.label} scaffolded.` : 'Recorded for Claude Code.', ok ? 'success' : 'info', lib.label);
  };
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}><strong>{lib.label}</strong> <span className="fx-mono fx-muted fx-small">{lib.packageName}</span></p>
      <div><p className="fx-eyebrow">Features to include</p><div className="fx-row fx-row--wrap">{lib.features.map((f) => <button key={f} className={`fx-chip ${include.has(f) ? 'is-selected' : ''}`} title={items.find((i) => i.id === f)?.title} onClick={() => setInclude((p) => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n; })}>{(items.find((i) => i.id === f)?.title ?? f).slice(0, 28)} <Chip tone={api.statusTone(s.status(f))}>{s.status(f)}</Chip></button>)}</div></div>
      <div><p className="fx-eyebrow">Demo app template</p><div className="fx-row fx-row--wrap">{DEMO_TEMPLATES.map((t) => <button key={t} className={`fx-chip ${t === template ? 'is-selected' : ''}`} onClick={() => setTemplate(t)}>{t}</button>)}</div></div>
      <label className="fx-field">Demo app name<input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      {log && <Code>{log}</Code>}
      <div className="fx-row fx-row--end"><Button icon="copy" onClick={() => navigator.clipboard?.writeText(spec).then(() => rt.toast('Spec copied — paste into Claude Code.', 'success'))}>Copy spec</Button><Button tone="primary" icon="play" onClick={run}>{s.backend ? 'Run on build engine' : 'Record'}</Button><Button onClick={close}>Close</Button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* install wizard                                                       */
/* ------------------------------------------------------------------ */

function ParamField({ p, value, onChange }: { p: LibraryParam; value: string; onChange: (v: string) => void }) {
  const err = api.paramError(p, value);
  const def = api.paramDefaultText(p);
  if (p.type === 'bool') return <label className="fx-row"><input type="checkbox" checked={/^(true|yes|on|1)$/i.test(value || def)} onChange={(e) => onChange(String(e.target.checked))} /> {p.label}{p.help && <span className="fx-muted fx-small"> — {p.help}</span>}</label>;
  if (p.type === 'choice') return <div className="fx-stack" style={{ gap: 4 }}><span>{p.label}</span>{p.help && <span className="fx-muted fx-small">{p.help}</span>}<div className="fx-row fx-row--wrap">{p.choices?.map((c) => <button key={c} className={`fx-chip ${(value || def) === c ? 'is-selected' : ''}`} onClick={() => onChange(c)}>{c}</button>)}</div></div>;
  return <label className="fx-field">{p.label}{p.required ? ' *' : ''}{p.type === 'list' ? <textarea className="fx-input fx-mono" rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={def || p.help} /> : <input className="fx-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={def || p.help} />}{p.help && <span className="fx-muted fx-small">{p.help}</span>}{err && <span className="fx-no fx-small">{err}</span>}</label>;
}

/**
 * The interactive install wizard: walks every parameter the library's `library.json` declares (one step each,
 * validated), shows the resulting manifest block + install script, then runs `POST /api/install` against the open
 * project — or records the script for Claude Code when no engine is configured.
 */
export function InstallWizardDialog({ libraryId, close }: { libraryId: string; close: () => void }) {
  const s = useStore();
  const rt = useRuntime();
  const term = useTerminal('install');
  const lib: InstallableLibrary | undefined = s.libraries.find((l) => l.id === libraryId || l.module === libraryId || l.module === `lib-${libraryId}`);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((lib?.params ?? []).map((p) => [p.key, api.paramDefaultText(p)])));
  const [step, setStep] = useState(0);
  const [log, setLog] = useState('');
  if (!lib) return <p>No library.json for "{libraryId}" — run <code>node framework/cli/tracker.mjs</code> to refresh libraries.json.</p>;
  const params = lib.params ?? [];
  const summary = step >= params.length;
  const cfg = Object.fromEntries(params.map((p) => [p.key, api.paramToJson(p, answers[p.key] ?? '') ?? p.default]));
  const slug = lib.module.replace(/^lib-/, '');
  const script = `node framework/cli/axf.mjs install ${slug} ${s.project || '<appDir>'} --yes \\\n` + params.map((p) => `    --param ${p.key}="${(answers[p.key] || api.paramDefaultText(p))}"`).join(' \\\n');
  const run = async () => {
    const id = `install-${slug}-${Date.now().toString(36)}`;
    if (!s.project) { term.recorded('No project open — open one, or run the copied script against your app.', script); s.addPort({ id, kind: 'install', name: lib.name, source: lib.module, project: '', status: 'recorded', createdAt: now(), log: script }); setLog('No project open — recorded.'); return; }
    term.start(`${lib.name} → ${s.project}`);
    const r = await api.post('install', { dir: s.project, library: lib.id, params: cfg });
    term.result(r, `${lib.name} installed into ${s.project} (${(r.changed as string[] | undefined)?.length ?? 0} files)`);
    if (!r.ok && !s.backend) term.recorded('Build engine offline — recorded; run the copied script with Claude Code.', script);
    setLog(r.ok ? `✓ changed:\n  ${((r.changed as string[]) ?? []).join('\n  ')}` : `✗ ${r.error}`);
    s.addPort({ id, kind: 'install', name: lib.name, source: lib.module, project: s.project, status: r.ok ? 'installed' : 'recorded', createdAt: now(), log: r.ok ? JSON.stringify(r.log ?? []) : script });
    rt.toast(r.ok ? `${lib.name} installed into ${s.project}` : r.error ?? 'Recorded', r.ok ? 'success' : 'warning', lib.name);
  };
  return (
    <div className="fx-stack">
      <div className="fx-row"><strong className="fx-grow">{lib.name}</strong><Chip tone="accent">{summary ? 'review' : `step ${step + 1}/${params.length}`}</Chip></div>
      <p className="fx-muted" style={{ margin: 0 }}>{lib.description}</p>
      <p className="fx-mono fx-small fx-muted" style={{ margin: 0 }}>project: {s.project || 'none open'} · manifest key {lib.manifestKey} · module {lib.module}</p>
      {!summary ? <ParamField p={params[step]!} value={answers[params[step]!.key] ?? ''} onChange={(v) => setAnswers({ ...answers, [params[step]!.key]: v })} /> : (
        <>
          <p className="fx-eyebrow">What the installer writes</p>
          <Code>{`axf.manifest.json → ${lib.manifestKey} = ${JSON.stringify(cfg)}\nandroid.modules += ${lib.id}\napp/build.gradle.kts += ${lib.install?.gradle ?? ''}\nApp.kt modules() += ${lib.install?.module ?? ''}\ngenerated: app/src/main/kotlin/<pkg>/axf/${slug[0]!.toUpperCase() + slug.slice(1)}Setup.kt (parameters as typed Kotlin)`}</Code>
          <Code>{script}</Code>
          {log && <Code>{log}</Code>}
        </>)}
      <div className="fx-row fx-row--end">
        {step > 0 && <Button icon="arrow-left" onClick={() => setStep(step - 1)}>Back</Button>}
        {!summary ? <Button tone="primary" icon="arrow-right" disabled={!!api.paramError(params[step]!, answers[params[step]!.key] ?? '')} onClick={() => setStep(step + 1)}>Next</Button> : (<>
          <Button icon="copy" onClick={() => navigator.clipboard?.writeText(script).then(() => rt.toast('Install script copied.', 'success'))}>Copy script</Button>
          <Button tone="primary" icon="download" onClick={run}>{s.backend ? 'Install' : 'Record'}</Button>
        </>)}
        <Button onClick={close}>Close</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UI-library import wizard                                             */
/* ------------------------------------------------------------------ */

const IMPORT_KINDS = ['BUTTON', 'ICON_BUTTON', 'TEXT_FIELD', 'SWITCH', 'CHECKBOX', 'CHIP', 'BADGE', 'SLIDER', 'CARD', 'LIST_ITEM', 'SECTION_HEADER', 'DIVIDER'];

/**
 * Port a third-party UI library to a new AmberX UI library. Steps: name the new kit → where the sources come from
 * (git / maven / npm / local) → which component kinds it covers → review. Run: the build engine clones the library,
 * refactors it to AXF tokens, saves `kit-<id>` + the ui-kit asset, and applies it to the open project as its default kit.
 */
export function UiImportWizardDialog({ sourceId, close }: { sourceId: string; close: () => void }) {
  const s = useStore();
  const rt = useRuntime();
  const term = useTerminal('import');
  const src = UI_LIBRARIES.find((l) => l.id === sourceId);
  const guessKind = src ? (src.stack.startsWith('http') ? 'git' : src.stack.startsWith('@') || /^[a-z-]+$/.test(src.stack) ? 'npm' : 'maven') : 'git';
  const [name, setName] = useState(src ? `AmberX ${src.name.replace(/\s*\(.*\)$/, '')}` : '');
  const [kitId, setKitId] = useState(src ? `ax-${src.id}` : '');
  const [kind, setKind] = useState<'git' | 'maven' | 'npm' | 'local'>(guessKind);
  const [location, setLocation] = useState(src?.stack ?? '');
  const [version, setVersion] = useState('');
  const [covers, setCovers] = useState<Set<string>>(new Set(IMPORT_KINDS.slice(0, 8)));
  const [apply, setApply] = useState(true);
  const [step, setStep] = useState(0);
  const [log, setLog] = useState('');
  const slug = kitId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const locKey = kind === 'git' ? 'url' : kind === 'local' ? 'path' : 'coordinate';
  const script = `node framework/cli/axf.mjs import-ui --name "${name}" --kit ${slug} --source ${kind} --${locKey} "${location}"${version ? ` --version ${version}` : ''} --covers ${[...covers].join(',')}${apply && s.project ? ` --apply ${s.project}` : ''}`;
  const steps = ['Name', 'Source', 'Coverage', 'Review'];
  const run = async () => {
    const id = `ui-import-${slug}`;
    term.start(`${src?.name ?? sourceId} → ${name} (kit-${slug})${apply && s.project ? ` → ${s.project}` : ''}`);
    const r = await api.post('import-ui', { name, kitId: slug, library: src?.name ?? name, version, source: { kind, [locKey]: location }, covers: [...covers], dir: apply && s.project ? s.project : undefined });
    if (r.log) rt.terminal.many('import', r.log);
    const report = r.report as { steps?: { step: string; notCovered?: string[]; filesChanged?: number; totals?: Record<string, number> }[] } | undefined;
    const save = report?.steps?.find((x) => x.step === 'save'); const refactor = report?.steps?.find((x) => x.step === 'refactor');
    if (save?.notCovered?.length) rt.terminal.note('import', `${save.notCovered.length} component kind(s) have no counterpart in ${name} and fall back to the default AmberX kit: ${save.notCovered.join(', ')}`);
    if (r.ok) rt.terminal.ok('import', `${String(r.module)} saved as hot-swappable ui-kit asset "${String(r.kitId)}"${apply && s.project ? ` and applied to ${s.project}` : ''}`); else rt.terminal.error('import', r.error ?? 'failed');
    if (!r.ok && !s.backend) term.recorded('Build engine offline — recorded; run the copied script with Claude Code.', script);
    setLog(r.ok ? `✓ ${String(r.module)} (ui-kit "${String(r.kitId)}")${refactor ? `\n  refactored ${refactor.filesChanged} file(s): ${JSON.stringify(refactor.totals)}` : ''}` : `✗ ${r.error}`);
    s.addPort({ id, kind: 'ui-import', name, source: `${kind} ${location}`, project: apply ? s.project : '', status: r.ok ? 'ported' : 'recorded', createdAt: now(), log: r.ok ? JSON.stringify(r.log ?? []) : script });
    rt.toast(r.ok ? `${name} ported${apply && s.project ? ` and applied to ${s.project}` : ''}` : r.error ?? 'Recorded', r.ok ? 'success' : 'warning', 'Import');
    if (r.ok) s.refresh();
  };
  return (
    <div className="fx-stack">
      <div className="fx-row"><strong className="fx-grow">Import {src?.name ?? sourceId} → AmberX UI library</strong><Chip tone="accent">{steps[step]} {step + 1}/{steps.length}</Chip></div>
      {step === 0 && <>
        <p className="fx-muted" style={{ margin: 0 }}>The new library becomes <code>framework/android/kit-&lt;id&gt;</code> with an AxfUiKit, a token bridge and a <code>ui-kit</code> asset; apps switch to it by swapping that asset.</p>
        <label className="fx-field">New AmberX UI library name *<input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="AmberX Cupertino" autoFocus /></label>
        <label className="fx-field">Kit id (ui-kit asset id) *<input className="fx-input fx-mono" value={kitId} onChange={(e) => setKitId(e.target.value)} placeholder="ax-cupertino" /></label>
      </>}
      {step === 1 && <>
        <p className="fx-muted" style={{ margin: 0 }}>Where the library's code comes from. git / local sources are cloned and refactored to AXF tokens; maven / npm are wrapped as a dependency and the kit's overrides call their widgets.</p>
        <div className="fx-row fx-row--wrap">{(['git', 'maven', 'npm', 'local'] as const).map((k) => <button key={k} className={`fx-chip ${kind === k ? 'is-selected' : ''}`} onClick={() => setKind(k)}>{k}</button>)}</div>
        <label className="fx-field">{kind === 'git' ? 'Repository URL *' : kind === 'local' ? 'Path on the build machine *' : 'Coordinate *'}<input className="fx-input fx-mono" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={kind === 'git' ? 'https://github.com/vendor/library' : kind === 'local' ? '/home/me/library' : kind === 'npm' ? '@scope/package' : 'group:artifact:version'} /></label>
        <label className="fx-field">Version / git ref (optional)<input className="fx-input fx-mono" value={version} onChange={(e) => setVersion(e.target.value)} /></label>
      </>}
      {step === 2 && <>
        <p className="fx-muted" style={{ margin: 0 }}>Component kinds the ported kit renders. Everything else keeps falling back to the default AmberX kit, so the app never breaks while the port is incomplete — each fallback is noted on the output terminal.</p>
        <div className="fx-row fx-row--wrap">{IMPORT_KINDS.map((k) => <button key={k} className={`fx-chip ${covers.has(k) ? 'is-selected' : ''}`} onClick={() => setCovers((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>{k}</button>)}</div>
        <label className="fx-row"><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> Apply to the open project <span className="fx-muted fx-small">— {s.project ? `installs kit-${slug} into ${s.project} and makes it the default ui-kit` : 'no project open; the kit is saved to the framework only'}</span></label>
      </>}
      {step === 3 && <>
        <p className="fx-eyebrow">What the importer does</p>
        <Code>{`1. clone     ${kind === 'git' || kind === 'local' ? `${location} → framework/vendor/${slug}` : `record ${kind} dependency ${location}`}\n2. refactor  Color(0x…) / MaterialTheme.colorScheme.* / typography.* / RoundedCornerShape(N.dp) → Axf.* tokens (tokens.map.json, port-report.json)\n3. save      framework/android/kit-${slug} (${name || '?'}Kit, ${name || '?'}KitModule, AxfPorted bridge, library.json) + android/assets/ui-kit/${slug}.json\n4. apply     ${apply && s.project ? `${s.project}: install kit-${slug}, defaults.ui-kit = ${slug}` : '(skipped)'}`}</Code>
        <Code>{script}</Code>
        {log && <Code>{log}</Code>}
      </>}
      <div className="fx-row fx-row--end">
        {step > 0 && <Button icon="arrow-left" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 3 ? <Button tone="primary" icon="arrow-right" disabled={step === 0 ? !name.trim() || !slug : step === 1 ? !location.trim() : false} onClick={() => setStep(step + 1)}>Next</Button> : (<>
          <Button icon="copy" onClick={() => navigator.clipboard?.writeText(script).then(() => rt.toast('Import script copied.', 'success'))}>Copy script</Button>
          <Button tone="primary" icon="download" onClick={run}>{s.backend ? 'Import' : 'Record'}</Button>
        </>)}
        <Button onClick={close}>Close</Button>
      </div>
    </div>
  );
}
