/*
 * AI assistant settings: the in-chat settings dialog, and the panels of Settings → Plugins → AI assistant (setup wizard,
 * providers, behaviour, prompts, usage). The plugin never ships its own settings screen — these are settings-tab panels.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import {
  call, catalogStore, configStore, del, fmtNum, fmtTime, post, put, statusStore,
  type AgentRef, type Config, type ContractInfo, type ConvSettings, type LiveSessionInfo, type SessionHostInfo, type Profile, type PromptItem, type ProviderKind, type Usage,
} from './api';

function useStore<T>(s: { get: () => T | undefined; subscribe: (f: () => void) => () => void; reload: () => Promise<T | undefined>; error: () => string }) {
  useEffect(() => { if (s.get() === undefined) void s.reload(); }, []);
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
export const useConfig = () => useStore(configStore);
export const useCatalog = () => useStore(catalogStore);
const refreshAll = () => Promise.all([configStore.reload(), statusStore.reload()]);

async function saveConfig(patch: Partial<Config>) {
  const c = await put<Config>('config', patch);
  configStore.set(c);
  void statusStore.reload();
  return c;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="axp-ai-assistant__field"><span>{label}</span>{children}{hint && <span className="fx-small fx-muted">{hint}</span>}</label>;
}
function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return <label className="axp-ai-assistant__toggle"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}{hint && <span className="fx-small fx-muted"> — {hint}</span>}</span></label>;
}

/* ================================================================ in-chat settings dialog */

export function ChatSettingsDialog({ settings, onChange, onClose, onOpenFull }: { settings: ConvSettings; onChange: (s: Partial<ConvSettings>) => Promise<void> | void; onClose: () => void; onOpenFull: () => void }) {
  const cfg = useConfig();
  const [agents, setAgents] = useState<AgentRef[] | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sys, setSys] = useState(settings.systemPrompt ?? '');
  useEffect(() => { void call<{ available: boolean; items: AgentRef[] }>('agents').then((r) => setAgents(r.available ? r.items : null)); }, []);
  const profiles = cfg?.profiles ?? [];
  const pid = settings.profileId || cfg?.defaultProfile || '';
  const prof = profiles.find((p) => p.id === pid);
  useEffect(() => { setModels(prof?.models ?? []); }, [prof?.id]);
  const fetchModels = async () => {
    if (!pid) return;
    setBusy(true); setMsg('');
    try { setModels((await call<{ models: string[] }>(`profiles/${pid}/models`)).models); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const p = cfg?.params;
  return (
    <div className="axp-ai-assistant__sheet" role="dialog" aria-modal="true" aria-label="Chat settings" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="axp-ai-assistant__sheet-panel fx-stack">
        <header className="axp-ai-assistant__sheet-head"><Icon name="sliders" size={16} /><h3>Chat settings</h3><button type="button" className="fx-iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" size={14} /></button></header>
        <p className="fx-small fx-muted">These apply to this conversation. Defaults live in Settings → Plugins → AI assistant.</p>
        {agents && (
          <Field label="Agent" hint="Chat as an agent from the agent manager: its persona, skills, tools and memory.">
            <select className="fx-input" value={settings.agentId ?? ''} onChange={(e) => void onChange({ agentId: e.target.value })}>
              <option value="">None — {cfg?.assistantName ?? 'assistant'}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.origin?.startsWith('addon') ? ' (add-on)' : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Provider">
          <select className="fx-input" value={settings.profileId ?? ''} onChange={(e) => void onChange({ profileId: e.target.value, model: '' })}>
            <option value="">Default ({profiles.find((x) => x.id === cfg?.defaultProfile)?.label ?? 'none'})</option>
            {profiles.filter((x) => x.enabled).map((x) => <option key={x.id} value={x.id}>{x.label}{x.keyReady ? '' : ' (no key)'}</option>)}
          </select>
        </Field>
        <Field label="Model" hint={prof ? `Default for ${prof.label}: ${prof.defaultModel || '—'}` : undefined}>
          <div className="fx-row">
            <input className="fx-input fx-mono fx-grow" list="axp-ai-assistant-models" value={settings.model ?? ''} placeholder={prof?.defaultModel || 'model id'} onChange={(e) => void onChange({ model: e.target.value })} />
            <Button icon="refresh" disabled={busy || !pid} onClick={() => void fetchModels()}>Fetch</Button>
          </div>
          <datalist id="axp-ai-assistant-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label={`Temperature: ${settings.temperature ?? p?.temperature ?? 'default'}`}>
          <input type="range" min={0} max={2} step={0.05} value={settings.temperature ?? p?.temperature ?? 0.7} onChange={(e) => void onChange({ temperature: Number(e.target.value) })} />
        </Field>
        <Field label="Max output tokens">
          <input className="fx-input" type="number" min={16} max={200000} value={settings.max_tokens ?? ''} placeholder={String(p?.max_tokens ?? 4096)} onChange={(e) => void onChange({ max_tokens: e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
        <Toggle label="Tools" hint="repo reading, time, calculator, web fetch, and the agent's tools" checked={settings.tools !== false} onChange={(v) => void onChange({ tools: v })} />
        <Toggle label="Extended thinking" hint="Anthropic models: reasons before answering" checked={settings.thinking ?? p?.thinking ?? false} onChange={(v) => void onChange({ thinking: v })} />
        <Field label="Instructions for this conversation">
          <textarea className="fx-input" rows={3} value={sys} onChange={(e) => setSys(e.target.value)} onBlur={() => void onChange({ systemPrompt: sys })} placeholder="e.g. Answer as a code reviewer; reply in Spanish" />
        </Field>
        {msg && <div className="axp-ai-assistant__note is-warn"><Icon name="alert" size={14} />{msg}</div>}
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void onChange({ profileId: '', model: '', temperature: undefined, max_tokens: undefined, systemPrompt: '', tools: undefined, thinking: undefined })}>Reset to defaults</Button>
          <Button icon="settings" onClick={onOpenFull}>All assistant settings…</Button>
          <Button tone="primary" icon="check" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ profile form (wizard + providers panel) */

interface Draft { id?: string; kind: string; label: string; baseUrl: string; keyMode: 'env' | 'stored' | 'none'; keyEnv: string; key: string; defaultModel: string; models: string[]; embedModel: string }

function draftFor(kind: ProviderKind, p?: Profile): Draft {
  return {
    id: p?.id, kind: kind.kind, label: p?.label ?? kind.label, baseUrl: p?.baseUrl ?? kind.baseUrl,
    keyMode: p ? (p.hasKey ? 'stored' : p.keyEnv ? 'env' : 'none') : kind.auth === 'none' ? 'none' : 'stored',
    keyEnv: p?.keyEnv ?? kind.keyEnv, key: '', defaultModel: p?.defaultModel ?? kind.models[0] ?? '', models: p?.models ?? kind.models, embedModel: p?.embedModel ?? '',
  };
}

export function ProfileForm({ kind, profile, onSaved, onCancel, compact }: { kind: ProviderKind; profile?: Profile; onSaved: (p: Profile) => void; onCancel?: () => void; compact?: boolean }) {
  const [d, setD] = useState<Draft>(() => draftFor(kind, profile));
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const body = () => ({
    id: d.id, kind: d.kind, label: d.label, baseUrl: d.baseUrl, defaultModel: d.defaultModel, models: d.models, embedModel: d.embedModel,
    keyEnv: d.keyMode === 'env' ? d.keyEnv : '', key: d.keyMode === 'stored' ? (d.key || null) : '', auth: d.keyMode === 'none' ? 'none' : undefined,
  });
  const fetchModels = async () => {
    setBusy('models'); setMsg(null);
    try {
      const r = d.id && !d.key ? await call<{ models: string[] }>(`profiles/${d.id}/models`) : await post<{ models: string[] }>('profiles/draft/models', body());
      setD((x) => ({ ...x, models: r.models, defaultModel: x.defaultModel && r.models.includes(x.defaultModel) ? x.defaultModel : r.models[0] ?? x.defaultModel }));
      setMsg({ ok: true, text: `${r.models.length} models found` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(''); }
  };
  const save = async (test: boolean) => {
    setBusy(test ? 'test' : 'save'); setMsg(null);
    try {
      const r = await post<{ profile: Profile }>('profiles', body());
      setD((x) => ({ ...x, id: r.profile.id, key: '' }));
      if (test) {
        const t = await post<{ ok: boolean; reply: string; ms: number }>(`profiles/${r.profile.id}/test`, { model: d.defaultModel });
        setMsg({ ok: true, text: `Connected in ${t.ms} ms — the model replied “${t.reply}”` });
      } else setMsg({ ok: true, text: 'Saved' });
      await refreshAll();
      onSaved(r.profile);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); await refreshAll(); } finally { setBusy(''); }
  };
  const needsUrl = kind.local || ['custom', 'azure-openai', 'ollama', 'lmstudio'].includes(kind.kind);
  return (
    <div className="axp-ai-assistant__card fx-stack">
      <div className="fx-row fx-row--wrap"><strong className="fx-grow">{kind.label}</strong>{kind.keyUrl && <a className="fx-small" href={kind.keyUrl} target="_blank" rel="noopener noreferrer">Get a key <Icon name="external" size={11} /></a>}</div>
      {kind.note && <p className="fx-small fx-muted">{kind.note}</p>}
      {!compact && <Field label="Name"><input className="fx-input" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></Field>}
      {(needsUrl || !compact) && kind.protocol !== 'claude-cli' && <Field label="Base URL" hint={kind.local ? 'Where the server runs, as the console server sees it (on the VPS: often http://host.docker.internal:11434/v1 or the container name)' : undefined}><input className="fx-input fx-mono" value={d.baseUrl} onChange={(e) => setD({ ...d, baseUrl: e.target.value })} /></Field>}
      <Field label={kind.protocol === 'claude-cli' ? 'Claude Code token' : 'API key'}>
        <select className="fx-input" value={d.keyMode} onChange={(e) => setD({ ...d, keyMode: e.target.value as Draft['keyMode'] })}>
          <option value="stored">Paste it here (stored on the console server only, never sent back)</option>
          <option value="env">Read it from a server environment variable</option>
          <option value="none">No key (local servers)</option>
        </select>
      </Field>
      {d.keyMode === 'stored' && <input className="fx-input" type="password" autoComplete="off" value={d.key} placeholder={profile?.hasKey ? 'Saved — leave blank to keep it' : kind.protocol === 'claude-cli' ? 'sk-ant-oat01-… from `claude setup-token`' : 'Paste the key'} onChange={(e) => setD({ ...d, key: e.target.value })} aria-label="API key" />}
      {d.keyMode === 'env' && <input className="fx-input fx-mono" value={d.keyEnv} placeholder="OPENAI_API_KEY" onChange={(e) => setD({ ...d, keyEnv: e.target.value.toUpperCase() })} aria-label="Environment variable" />}
      <Field label="Default model">
        <div className="fx-row">
          <input className="fx-input fx-mono fx-grow" list={`axp-ai-models-${kind.kind}`} value={d.defaultModel} onChange={(e) => setD({ ...d, defaultModel: e.target.value })} />
          <Button icon="refresh" disabled={!!busy} onClick={() => void fetchModels()}>{busy === 'models' ? 'Fetching…' : 'Fetch models'}</Button>
        </div>
        <datalist id={`axp-ai-models-${kind.kind}`}>{d.models.map((m) => <option key={m} value={m} />)}</datalist>
      </Field>
      {!compact && kind.protocol === 'openai' && <Field label="Embedding model (optional)" hint="Used by the agent manager for vector memory"><input className="fx-input fx-mono" value={d.embedModel} placeholder={kind.kind === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'} onChange={(e) => setD({ ...d, embedModel: e.target.value })} /></Field>}
      {msg && <div className={`axp-ai-assistant__note ${msg.ok ? 'is-ok' : 'is-warn'}`}><Icon name={msg.ok ? 'check' : 'alert'} size={14} />{msg.text}</div>}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="zap" disabled={!!busy} onClick={() => void save(true)}>{busy === 'test' ? 'Testing…' : 'Save & test'}</Button>
        <Button icon="save" disabled={!!busy} onClick={() => void save(false)}>Save</Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}

/* ================================================================ setup wizard */

const STEPS = ['Welcome', 'Providers', 'Connect', 'Defaults', 'Personalize', 'Agents', 'Finish'] as const;

export function SetupWizard() {
  const rt = useRuntime();
  const cfg = useConfig();
  const cat = useCatalog();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [agents, setAgents] = useState<{ available: boolean; items: AgentRef[] } | null>(null);
  const [local, setLocal] = useState<Partial<Config>>({});
  useEffect(() => { void call<{ available: boolean; items: AgentRef[] }>('agents').then(setAgents, () => setAgents({ available: false, items: [] })); }, []);
  useEffect(() => { if (cfg && !picked.length) setPicked([...new Set(cfg.profiles.map((p) => p.kind))]); }, [cfg?.profiles.length]);
  if (!cfg || !cat) return <p className="fx-muted">Loading…</p>;
  const v = { ...cfg, ...local };
  const ready = cfg.profiles.filter((p) => p.keyReady && p.enabled);
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const finish = async () => {
    await saveConfig({ ...local, setupComplete: true });
    rt.toast(`${v.assistantName} is ready — open it from the nav (Plugins → AI assistant) or any chat button.`, 'success', 'Setup complete');
    setStep(0);
  };
  return (
    <div className="axp-ai-assistant__wizard fx-stack">
      <ol className="axp-ai-assistant__steps">{STEPS.map((s, i) => <li key={s} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}><button type="button" onClick={() => setStep(i)}>{i + 1}. {s}</button></li>)}</ol>

      {step === 0 && (
        <div className="fx-stack">
          <p>This wizard connects the assistant to one or more AI providers, picks defaults, and personalises it. You can re-run it any time; nothing is lost.</p>
          <ul className="fx-small">
            <li>Streamed chat in a dialog (any view) or full page, with conversations, search, pin, archive, fork, export.</li>
            <li>Many providers at once, with a fallback chain if one fails, and side-by-side model comparison.</li>
            <li>Reads the AXF repository, fetches web pages, accepts images and files, and runs agent tools.</li>
            <li>With the agent manager installed: chat as any agent, with its persistent memory.</li>
            <li>Replies are live sessions on the host: close the browser and come back on any device.</li>
          </ul>
          <p className="fx-small fx-muted">Providers come from the framework's shared registry (<code className="fx-mono">framework/schemas/ai-providers.json</code>, {cat.providers.length} kinds); every AXF app's assistant shares it.</p>
          {cfg.setupComplete && <Chip tone="success">Already set up — {ready.length} provider{ready.length === 1 ? '' : 's'} ready</Chip>}
        </div>
      )}

      {step === 1 && (
        <div className="fx-stack">
          <p className="fx-small fx-muted">Pick every provider you want available. You'll connect each one next.</p>
          <div className="axp-ai-assistant__grid">
            {cat.providers.map((k) => {
              const on = picked.includes(k.kind);
              const have = cfg.profiles.some((p) => p.kind === k.kind && p.keyReady);
              return (
                <button key={k.kind} type="button" className={`axp-ai-assistant__pick${on ? ' is-active' : ''}`} onClick={() => setPicked((x) => (on ? x.filter((y) => y !== k.kind) : [...x, k.kind]))} aria-pressed={on}>
                  <strong>{k.label}</strong>
                  <span className="fx-small fx-muted">{k.local ? 'local · no key' : k.protocol === 'claude-cli' ? (cat.cliInstalled ? 'CLI found' : 'needs the claude CLI') : k.keyEnv}</span>
                  {have && <Chip tone="success">connected</Chip>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="fx-stack">
          {picked.length === 0 && <p className="fx-muted">Go back and pick at least one provider.</p>}
          {picked.map((kind) => {
            const k = cat.providers.find((x) => x.kind === kind);
            if (!k) return null;
            const existing = cfg.profiles.find((p) => p.kind === kind);
            return <ProfileForm key={kind} kind={k} profile={existing} compact onSaved={() => undefined} />;
          })}
        </div>
      )}

      {step === 3 && (
        <div className="fx-stack">
          {ready.length === 0 && <div className="axp-ai-assistant__note is-warn"><Icon name="alert" size={14} />No provider is connected yet — go back to Connect and use “Save & test”.</div>}
          <Field label="Default provider">
            <select className="fx-input" value={v.defaultProfile} onChange={(e) => setLocal({ ...local, defaultProfile: e.target.value })}>
              {cfg.profiles.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.defaultModel}{p.keyReady ? '' : ' (no key)'}</option>)}
            </select>
          </Field>
          <Field label="Fallback order" hint="If the default fails before answering, these are tried in order.">
            <div className="fx-stack">
              {cfg.profiles.filter((p) => p.id !== v.defaultProfile).map((p) => {
                const on = (v.fallback ?? []).includes(p.id);
                return <Toggle key={p.id} label={`${p.label} · ${p.defaultModel}`} checked={on} onChange={(c) => setLocal({ ...local, fallback: c ? [...(v.fallback ?? []), p.id] : (v.fallback ?? []).filter((x) => x !== p.id) })} />;
              })}
            </div>
          </Field>
          <Field label={`Temperature: ${v.params.temperature ?? 0.7}`}><input type="range" min={0} max={2} step={0.05} value={v.params.temperature ?? 0.7} onChange={(e) => setLocal({ ...local, params: { ...v.params, temperature: Number(e.target.value) } })} /></Field>
          <Field label="Max output tokens"><input className="fx-input" type="number" value={v.params.max_tokens ?? 4096} onChange={(e) => setLocal({ ...local, params: { ...v.params, max_tokens: Number(e.target.value) } })} /></Field>
        </div>
      )}

      {step === 4 && (
        <div className="fx-stack">
          <Field label="Assistant name"><input className="fx-input" value={v.assistantName} onChange={(e) => setLocal({ ...local, assistantName: e.target.value })} /></Field>
          <Field label="Personality">
            <select className="fx-input" value={v.persona} onChange={(e) => setLocal({ ...local, persona: e.target.value })}>{cat.personas.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </Field>
          <Field label="Standing instructions" hint="Added to every conversation (not used when chatting as an agent, which brings its own)."><textarea className="fx-input" rows={4} value={v.instructions} onChange={(e) => setLocal({ ...local, instructions: e.target.value })} placeholder="e.g. I work from my phone: keep answers short. Prefer TypeScript." /></Field>
          <span className="fx-small fx-muted">Tools</span>
          {Object.entries(cat.toolGroups).map(([g, label]) => <Toggle key={g} label={label} checked={!!v.tools[g]} onChange={(c) => setLocal({ ...local, tools: { ...v.tools, [g]: c } })} />)}
        </div>
      )}

      {step === 5 && (
        <div className="fx-stack">
          {!agents?.available ? (
            <p className="fx-muted">No agent manager is installed. Install the agent manager plugin to chat with specialist agents (coder, AXF expert, AI expert …) that keep persistent memory. This step unlocks itself when it's there.</p>
          ) : (
            <>
              <Toggle label="Use the agent manager" hint={`${agents.items.length} agents available`} checked={v.agentIntegration} onChange={(c) => setLocal({ ...local, agentIntegration: c })} />
              <Field label="Default agent for new chats">
                <select className="fx-input" value={v.defaultAgent} onChange={(e) => setLocal({ ...local, defaultAgent: e.target.value })}>
                  <option value="">None — {v.assistantName}</option>
                  {agents.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
      )}

      {step === 6 && (
        <div className="fx-stack">
          <dl className="axp-ai-assistant__facts">
            <dt>Providers ready</dt><dd>{ready.map((p) => p.label).join(', ') || 'none'}</dd>
            <dt>Default</dt><dd>{cfg.profiles.find((p) => p.id === v.defaultProfile)?.label ?? '—'}</dd>
            <dt>Fallbacks</dt><dd>{(v.fallback ?? []).join(', ') || 'none'}</dd>
            <dt>Name · persona</dt><dd>{v.assistantName} · {v.persona}</dd>
            <dt>Tools</dt><dd>{Object.entries(v.tools).filter(([, on]) => on).map(([g]) => g).join(', ') || 'none'}</dd>
            <dt>Agents</dt><dd>{agents?.available ? (v.agentIntegration ? `on${v.defaultAgent ? `, default ${v.defaultAgent}` : ''}` : 'off') : 'no agent manager'}</dd>
          </dl>
          <div className="fx-row fx-row--wrap"><Button tone="primary" icon="check" disabled={!ready.length} onClick={() => void finish()}>Finish setup</Button><Button icon="sparkles" onClick={() => rt.openDialog('ai-assistant.chat')}>Try it now</Button></div>
        </div>
      )}

      <div className="fx-row fx-row--wrap axp-ai-assistant__wizard-nav">
        <Button icon="undo" disabled={step === 0} onClick={back}>Back</Button>
        {step < STEPS.length - 1 && <Button tone="primary" icon="play" onClick={() => { if (step >= 3 && Object.keys(local).length) void saveConfig(local).then(() => setLocal({})); next(); }}>Next</Button>}
      </div>
    </div>
  );
}

/* ================================================================ providers panel */

export function ProvidersPanel() {
  const cfg = useConfig();
  const cat = useCatalog();
  const [edit, setEdit] = useState<{ kind: ProviderKind; profile?: Profile } | null>(null);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  if (!cfg || !cat) return <p className="fx-muted">Loading…</p>;
  const test = async (p: Profile) => {
    setBusy(p.id);
    try { const r = await post<{ ms: number; reply: string }>(`profiles/${p.id}/test`, {}); setNote({ ...note, [p.id]: `✓ ${r.ms} ms · “${r.reply}”` }); }
    catch (e) { setNote({ ...note, [p.id]: `✗ ${(e as Error).message}` }); }
    finally { setBusy(''); void configStore.reload(); }
  };
  return (
    <div className="fx-stack">
      {cfg.profiles.length === 0 && <p className="fx-muted">No providers yet — use the setup wizard above or add one here.</p>}
      {cfg.profiles.map((p) => edit?.profile?.id === p.id ? (
        <ProfileForm key={p.id} kind={edit.kind} profile={p} onSaved={() => setEdit(null)} onCancel={() => setEdit(null)} />
      ) : (
        <div key={p.id} className="axp-ai-assistant__card fx-stack">
          <div className="fx-row fx-row--wrap">
            <strong className="fx-grow">{p.label}</strong>
            {cfg.defaultProfile === p.id && <Chip tone="accent">default</Chip>}
            {cfg.fallback.includes(p.id) && <Chip>fallback {cfg.fallback.indexOf(p.id) + 1}</Chip>}
            <Chip tone={p.keyReady ? 'success' : 'warning'}>{p.keyReady ? (p.hasKey ? 'key stored' : p.keyEnv ? `key from ${p.keyEnv}` : 'no key needed') : p.keyEnv ? `${p.keyEnv} not set` : 'no key'}</Chip>
            {!p.enabled && <Chip tone="danger">disabled</Chip>}
          </div>
          <span className="fx-small fx-muted fx-mono">{p.kind} · {p.defaultModel || 'no model'}{p.baseUrl ? ` · ${p.baseUrl}` : ''}</span>
          {p.lastTest && <span className="fx-small fx-muted">Last test {fmtTime(p.lastTest.at)}: {p.lastTest.ok ? `ok (${p.lastTest.ms} ms)` : p.lastTest.error}</span>}
          {note[p.id] && <span className="fx-small">{note[p.id]}</span>}
          <div className="fx-row fx-row--wrap">
            <Button icon="zap" disabled={busy === p.id} onClick={() => void test(p)}>{busy === p.id ? 'Testing…' : 'Test'}</Button>
            <Button icon="edit" onClick={() => { const k = cat.providers.find((x) => x.kind === p.kind) ?? cat.providers.find((x) => x.kind === 'custom'); if (k) setEdit({ kind: k, profile: p }); }}>Edit</Button>
            {cfg.defaultProfile !== p.id && <Button icon="star" onClick={() => void saveConfig({ defaultProfile: p.id })}>Make default</Button>}
            <Button icon={cfg.fallback.includes(p.id) ? 'minus' : 'plus'} onClick={() => void saveConfig({ fallback: cfg.fallback.includes(p.id) ? cfg.fallback.filter((x) => x !== p.id) : [...cfg.fallback, p.id] })}>{cfg.fallback.includes(p.id) ? 'Remove fallback' : 'Use as fallback'}</Button>
            <Button icon={p.enabled ? 'pause' : 'play'} onClick={() => void post('profiles', { id: p.id, kind: p.kind, enabled: !p.enabled }).then(refreshAll)}>{p.enabled ? 'Disable' : 'Enable'}</Button>
            <Button icon="trash" onClick={() => { if (confirm(`Remove ${p.label}? Its stored key is deleted.`)) void del(`profiles/${p.id}`).then(refreshAll); }}>Remove</Button>
          </div>
        </div>
      ))}
      {adding ? (
        <ProfileForm kind={cat.providers.find((k) => k.kind === adding)!} onSaved={() => setAdding('')} onCancel={() => setAdding('')} />
      ) : (
        <div className="fx-row fx-row--wrap">
          <select className="fx-input" defaultValue="" onChange={(e) => { if (e.target.value) setAdding(e.target.value); e.target.value = ''; }} aria-label="Add a provider">
            <option value="">Add a provider…</option>
            {cat.providers.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/* ================================================================ behaviour panel */

export function BehaviorPanel() {
  const cfg = useConfig();
  const cat = useCatalog();
  const [d, setD] = useState<Partial<Config>>({});
  const [saved, setSaved] = useState(false);
  const [agents, setAgents] = useState<AgentRef[] | null>(null);
  useEffect(() => { void call<{ available: boolean; items: AgentRef[] }>('agents').then((r) => setAgents(r.available ? r.items : null)); }, []);
  if (!cfg || !cat) return <p className="fx-muted">Loading…</p>;
  const v = { ...cfg, ...d, params: { ...cfg.params, ...(d.params ?? {}) }, tools: { ...cfg.tools, ...(d.tools ?? {}) } };
  const set = (p: Partial<Config>) => { setD({ ...d, ...p }); setSaved(false); };
  return (
    <div className="fx-stack">
      <div className="axp-ai-assistant__cols">
        <Field label="Assistant name"><input className="fx-input" value={v.assistantName} onChange={(e) => set({ assistantName: e.target.value })} /></Field>
        <Field label="Personality"><select className="fx-input" value={v.persona} onChange={(e) => set({ persona: e.target.value })}>{cat.personas.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
      </div>
      <Field label="Standing instructions"><textarea className="fx-input" rows={4} value={v.instructions} onChange={(e) => set({ instructions: e.target.value })} /></Field>
      <div className="axp-ai-assistant__cols">
        <Field label={`Temperature: ${v.params.temperature}`}><input type="range" min={0} max={2} step={0.05} value={v.params.temperature ?? 0.7} onChange={(e) => set({ params: { ...v.params, temperature: Number(e.target.value) } })} /></Field>
        <Field label="Max output tokens"><input className="fx-input" type="number" value={v.params.max_tokens ?? 4096} onChange={(e) => set({ params: { ...v.params, max_tokens: Number(e.target.value) } })} /></Field>
        <Field label="Turns of history sent"><input className="fx-input" type="number" min={2} max={400} value={v.contextMessages} onChange={(e) => set({ contextMessages: Number(e.target.value) })} /></Field>
        <Field label="Max tool rounds per reply"><input className="fx-input" type="number" min={1} max={50} value={v.maxToolRounds} onChange={(e) => set({ maxToolRounds: Number(e.target.value) })} /></Field>
        <Field label="Thinking budget (tokens)"><input className="fx-input" type="number" min={1024} value={v.params.thinking_budget} onChange={(e) => set({ params: { ...v.params, thinking_budget: Number(e.target.value) } })} /></Field>
        <Field label="Reasoning effort (OpenAI-style)"><select className="fx-input" value={v.params.reasoning_effort} onChange={(e) => set({ params: { ...v.params, reasoning_effort: e.target.value } })}><option value="">default</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></Field>
        <Field label="Daily token budget" hint="0 = unlimited"><input className="fx-input" type="number" min={0} value={v.dailyTokenBudget} onChange={(e) => set({ dailyTokenBudget: Number(e.target.value) })} /></Field>
        <Field label="Daily tokens per hub user" hint="non-admins signed in through axHub; 0 = unlimited"><input className="fx-input" type="number" min={0} value={v.userDailyTokens ?? 50000} onChange={(e) => set({ userDailyTokens: Number(e.target.value) })} /></Field>
      </div>
      <span className="fx-small fx-muted">Tools</span>
      {Object.entries(cat.toolGroups).map(([g, label]) => <Toggle key={g} label={label} checked={!!v.tools[g]} onChange={(c) => set({ tools: { ...v.tools, [g]: c } })} />)}
      <span className="fx-small fx-muted">Behaviour</span>
      <Toggle label="Extended thinking by default" hint="Anthropic models" checked={v.params.thinking} onChange={(c) => set({ params: { ...v.params, thinking: c } })} />
      <Toggle label="Show the model's reasoning while it streams" checked={v.showThinking} onChange={(c) => set({ showThinking: c })} />
      <Toggle label="Name conversations automatically" checked={v.autoTitle} onChange={(c) => set({ autoTitle: c })} />
      <Toggle label="Show model, time and tokens under replies" checked={v.showUsage} onChange={(c) => set({ showUsage: c })} />
      <Toggle label="Redact API keys and tokens from messages before they leave the console" checked={v.redactSecrets} onChange={(c) => set({ redactSecrets: c })} />
      <Toggle label="Keep the text of a reply interrupted by a console restart" hint="saved as an interrupted message you can continue from" checked={v.keepInterrupted !== false} onChange={(c) => set({ keepInterrupted: c })} />
      <span className="fx-small fx-muted">Agent manager</span>
      {agents ? (
        <>
          <Toggle label="Use the agent manager" hint={`${agents.length} agents`} checked={v.agentIntegration} onChange={(c) => set({ agentIntegration: c })} />
          <Field label="Default agent for new chats"><select className="fx-input" value={v.defaultAgent} onChange={(e) => set({ defaultAgent: e.target.value })}><option value="">None</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        </>
      ) : <p className="fx-small fx-muted">Not installed. When the agent manager plugin is installed and enabled, you can pick agents here and in every chat.</p>}
      <div className="fx-row fx-row--wrap"><Button tone="primary" icon="save" disabled={!Object.keys(d).length} onClick={() => void saveConfig(d).then(() => { setD({}); setSaved(true); })}>Save</Button>{saved && <Chip tone="success">saved</Chip>}</div>
    </div>
  );
}

/* ================================================================ prompts + suggestions */

export function PromptsPanel() {
  const cfg = useConfig();
  const [items, setItems] = useState<PromptItem[] | null>(null);
  const [sugg, setSugg] = useState('');
  useEffect(() => { if (cfg && items === null) { setItems(cfg.prompts); setSugg(cfg.suggestions.join('\n')); } }, [cfg]);
  if (!cfg || !items) return <p className="fx-muted">Loading…</p>;
  const upd = (i: number, p: Partial<PromptItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Prompts appear when you type their shortcut (e.g. /review) in the chat, and insert their text.</p>
      {items.map((p, i) => (
        <div key={p.id || i} className="axp-ai-assistant__card fx-stack">
          <div className="axp-ai-assistant__cols">
            <Field label="Title"><input className="fx-input" value={p.title} onChange={(e) => upd(i, { title: e.target.value })} /></Field>
            <Field label="Shortcut"><input className="fx-input fx-mono" value={p.shortcut} onChange={(e) => upd(i, { shortcut: e.target.value.startsWith('/') ? e.target.value.replace(/\s/g, '') : `/${e.target.value.replace(/\s/g, '')}` })} /></Field>
          </div>
          <textarea className="fx-input" rows={3} value={p.text} onChange={(e) => upd(i, { text: e.target.value })} aria-label="Prompt text" />
          <div><Button icon="trash" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</Button></div>
        </div>
      ))}
      <div><Button icon="plus" onClick={() => setItems([...items, { id: '', title: 'New prompt', shortcut: '/new-prompt', text: '' }])}>Add prompt</Button></div>
      <Field label="Suggestions on the empty chat (one per line)"><textarea className="fx-input" rows={4} value={sugg} onChange={(e) => setSugg(e.target.value)} /></Field>
      <div><Button tone="primary" icon="save" onClick={() => void saveConfig({ prompts: items, suggestions: sugg.split('\n').map((s) => s.trim()).filter(Boolean) })}>Save prompts</Button></div>
    </div>
  );
}

/* ================================================================ usage */

export function UsagePanel() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => { void call<Usage>('usage').then(setU); }, []);
  if (!u) return <p className="fx-muted">Loading…</p>;
  const max = Math.max(1, ...u.days.map((d) => d.input + d.output));
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap"><Chip tone="accent">today: {fmtNum(u.today.calls)} calls</Chip><Chip>{fmtNum(u.today.input)} in</Chip><Chip>{fmtNum(u.today.output)} out</Chip></div>
      {u.days.length > 0 && (
        <div className="axp-ai-assistant__bars" role="img" aria-label="Tokens per day, last 30 days">
          {u.days.map((d) => <span key={d.day} className="axp-ai-assistant__bar" style={{ height: `${Math.max(4, ((d.input + d.output) / max) * 100)}%` }} title={`${d.day}: ${fmtNum(d.input + d.output)} tokens, ${d.calls} calls`} />)}
        </div>
      )}
      <div className="fx-tablewrap"><table className="fx-table"><thead><tr><th>Provider</th><th>Model</th><th>Calls</th><th>In</th><th>Out</th></tr></thead>
        <tbody>{u.byProfileModel.map((r) => <tr key={`${r.profile}|${r.model}`}><td>{r.profile}</td><td className="fx-mono">{r.model}</td><td>{fmtNum(r.calls)}</td><td>{fmtNum(r.input)}</td><td>{fmtNum(r.output)}</td></tr>)}</tbody></table></div>
      {u.byProfileModel.length === 0 && <p className="fx-muted fx-small">No calls yet.</p>}
      {u.users && u.users.length > 0 && (
        <div className="fx-tablewrap"><table className="fx-table"><thead><tr><th>Hub user</th><th>Today</th><th>Last 30 days</th></tr></thead>
          <tbody>{u.users.map((r) => <tr key={r.user}><td>{r.user}</td><td>{fmtNum(r.today)}</td><td>{fmtNum(r.month)}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

/* ================================================================ live sessions */

/** Where chats live, and which are open. Replies run on the host, so closing the browser never stops them. */
export function SessionsPanel() {
  const rt = useRuntime();
  const cfg = useConfig();
  const [d, setD] = useState<{ host: string; active: string; hosts: SessionHostInfo[]; items: LiveSessionInfo[] } | null>(null);
  const [ci, setCi] = useState<ContractInfo | null>(null);
  const [err, setErr] = useState('');
  const load = () => call<{ host: string; active: string; hosts: SessionHostInfo[]; items: LiveSessionInfo[] }>('sessions').then(setD, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); void call<ContractInfo>('contract').then(setCi, () => undefined); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, []);
  if (!d) return <p className="fx-muted">{err || 'Loading…'}</p>;
  const pick = d.host || cfg?.sessionHost || 'local';
  const closeOne = async (s: LiveSessionInfo) => {
    if (!window.confirm(`End the live session for “${s.title || s.id}”? ${s.state === 'running' ? 'Its running reply stops. ' : ''}The conversation itself is kept.`)) return;
    await post(`sessions/${s.id}/close`, {}).catch((e: Error) => rt.toast(e.message, 'danger'));
    void load();
  };
  return (
    <div className="fx-stack">
      <p className="fx-muted fx-small">Every chat is a live session on its host. Closing the browser, the dialog or the app only detaches: the reply keeps going, and opening the chat again on any device catches up and follows it. A session ends only when you end it here or delete the conversation. A console restart mid-reply keeps the text that had arrived as an interrupted message.</p>
      {ci && <div className="fx-row fx-row--wrap"><Chip>{ci.liveSession}</Chip><Chip>{ci.assistant}</Chip>{ci.hosts.map((h) => <Chip key={h.id} tone={h.available ? 'success' : undefined}>{h.label}: {h.available ? 'available' : 'placeholder'}</Chip>)}</div>}
      <Field label="Session host" hint={d.hosts.find((h) => h.id === pick)?.note}>
        <select className="fx-input" value={pick} onChange={(e) => void saveConfig({ sessionHost: e.target.value }).then(load)}>
          {d.hosts.map((h) => <option key={h.id} value={h.id}>{h.label}{h.available ? '' : ' — not available yet'}</option>)}
        </select>
      </Field>
      {pick !== d.active && <Chip tone="warning">Running on {d.hosts.find((h) => h.id === d.active)?.label ?? (d.active || 'no host')} until {d.hosts.find((h) => h.id === pick)?.label ?? pick} is available</Chip>}
      <p className="fx-small fx-muted">Hosts are an open registry: a plugin providing <code className="fx-mono">axf.live-host@1</code> (axHub's session workers, when built) takes over without any change here.</p>
      {d.items.length === 0 ? <p className="fx-muted fx-small">No live sessions yet.</p> : (
        <div className="fx-tablewrap"><table className="fx-table"><thead><tr><th>Chat</th><th>State</th><th>Watching</th><th>Last activity</th><th /></tr></thead>
          <tbody>{d.items.map((s) => (
            <tr key={s.id}>
              <td>{s.title || s.id}</td>
              <td><Chip tone={s.state === 'running' ? 'accent' : s.state === 'waiting' ? 'warning' : undefined}>{s.state}</Chip></td>
              <td>{s.viewers}</td>
              <td>{fmtTime(s.updatedAt)}</td>
              <td className="fx-row">{s.state === 'running' && <Button icon="pause" onClick={() => void post(`sessions/${s.id}/stop`, {}).then(load)}>Stop</Button>}<Button icon="sparkles" onClick={() => rt.openDialog('ai-assistant.chat', { open: s.id })}>Open</Button><Button icon="x" onClick={() => void closeOne(s)}>End</Button></td>
            </tr>
          ))}</tbody></table></div>
      )}
    </div>
  );
}
