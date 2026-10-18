/* Settings → Plugins → Agent manager panels: wizards, model, training & Firecrawl, memory defaults, integration. */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import { Field, Num, Text } from './forms';
import { WIZARDS, useData } from './wizards';
import { MEMORY_HELP, call, post, put, refresh, type Settings } from './api';

function useSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState('');
  const load = () => call<Settings>('settings').then(setS, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const saveS = async (patch: Record<string, unknown>) => { const r = await put<Settings>('settings', patch); setS(r); void refresh().catch(() => undefined); return r; };
  return { s, err, saveS, load };
}

export function WizardsPanel() {
  const rt = useRuntime();
  return (
    <div className="axp-agent-manager__grid">
      {Object.entries(WIZARDS).map(([k, w]) => (
        <button key={k} type="button" className="axp-agent-manager__tile" onClick={() => rt.openDialog('agent-manager.wizard', { kind: k })}>
          <strong><Icon name={w.icon} size={14} /> {w.title}</strong><span className="fx-small fx-muted">{w.description}</span>
        </button>
      ))}
      <button type="button" className="axp-agent-manager__tile" onClick={() => rt.navigate('agent-manager')}><strong><Icon name="layers" size={14} /> Open the agent manager</strong><span className="fx-small fx-muted">Agents, skills, tools, memory, workflows, runs.</span></button>
    </div>
  );
}

export function ModelPanel() {
  const { status } = useData();
  const { s, err, saveS } = useSettings();
  const [llm, setLlm] = useState<Record<string, string>>({});
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  if (err) return <p className="axp-agent-manager__bad">{err}</p>;
  if (!s) return <p className="fx-muted">Loading…</p>;
  const v = { ...s.llm, ...llm };
  const test = async () => { setMsg('Testing…'); try { const r = await post<{ reply: string; source: string; model: string }>('settings/test'); setMsg(`✓ ${r.source} · ${r.model}: “${r.reply}”`); } catch (e) { setMsg(`✗ ${(e as Error).message}`); } };
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <Chip tone={status?.assistant ? 'success' : undefined}>{status?.assistant ? 'AI assistant installed' : 'AI assistant not installed'}</Chip>
        <Chip tone="accent">using: {status?.llm.source === 'assistant' ? "the assistant's providers" : 'own model settings'}</Chip>
      </div>
      <label className="axp-agent-manager__toggle"><input type="checkbox" checked={s.preferAssistant} onChange={(e) => void saveS({ preferAssistant: e.target.checked })} /> Use the AI assistant's providers when it's installed (same keys, fallback chain and usage)</label>
      <p className="fx-small fx-muted">Own model settings are used when the assistant isn't installed (or the box above is off).</p>
      <div className="axp-agent-manager__cols">
        <Field label="API style"><select className="fx-input" value={v.kind} onChange={(e) => setLlm({ ...llm, kind: e.target.value })}><option value="anthropic">Anthropic</option><option value="openai">OpenAI / compatible</option><option value="ollama">Ollama (OpenAI-compatible)</option></select></Field>
        <Field label="Base URL (optional)"><Text mono value={v.baseUrl} onChange={(baseUrl) => setLlm({ ...llm, baseUrl })} placeholder={v.kind === 'anthropic' ? 'https://api.anthropic.com' : v.kind === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'} /></Field>
        <Field label="Model"><Text mono value={v.model} onChange={(model) => setLlm({ ...llm, model })} /></Field>
        <Field label="Embedding model (optional)"><Text mono value={v.embedModel} onChange={(embedModel) => setLlm({ ...llm, embedModel })} placeholder="text-embedding-3-small" /></Field>
        <Field label="Key from env var"><Text mono value={v.keyEnv} onChange={(keyEnv) => setLlm({ ...llm, keyEnv: keyEnv.toUpperCase() })} /></Field>
        <Field label={`Or store a key${s.llm.hasKey ? ' (saved)' : ''}`}><input className="fx-input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.llm.hasKey ? 'leave blank to keep' : 'paste key'} aria-label="API key" /></Field>
      </div>
      <span className="fx-small fx-muted">{s.llm.envPresent ? `${s.llm.keyEnv} is set on the server.` : s.llm.hasKey ? 'A key is stored on the server.' : 'No key yet.'} Keys never come back to the browser.</span>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="save" onClick={() => void saveS({ llm: { ...llm, ...(key ? { key } : {}) } }).then(() => { setLlm({}); setKey(''); setMsg('Saved'); })}>Save</Button>
        <Button icon="zap" onClick={() => void test()}>Test</Button>
      </div>
      {msg && <span className="fx-small">{msg}</span>}
    </div>
  );
}

export function TrainingPanel() {
  const { s, err, saveS } = useSettings();
  const [fc, setFc] = useState<Record<string, string>>({});
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  if (err) return <p className="axp-agent-manager__bad">{err}</p>;
  if (!s) return <p className="fx-muted">Loading…</p>;
  const v = { ...s.firecrawl, ...fc };
  const test = async () => { setMsg('Testing…'); try { const r = await post<{ title: string; chars: number }>('settings/test-firecrawl', { url: 'https://example.com' }); setMsg(`✓ scraped “${r.title}” (${r.chars} chars)`); } catch (e) { setMsg(`✗ ${(e as Error).message}`); } };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Firecrawl turns websites into clean Markdown for training (scrape, crawl, search). URL, repo, text and MCP sources work without it.</p>
      <div className="axp-agent-manager__cols">
        <Field label="Firecrawl base URL" hint="Change for a self-hosted Firecrawl"><Text mono value={v.baseUrl} onChange={(baseUrl) => setFc({ ...fc, baseUrl })} /></Field>
        <Field label="API version"><select className="fx-input" value={v.version} onChange={(e) => setFc({ ...fc, version: e.target.value })}><option value="v2">v2</option><option value="v1">v1</option></select></Field>
        <Field label="Key from env var"><Text mono value={v.keyEnv} onChange={(keyEnv) => setFc({ ...fc, keyEnv: keyEnv.toUpperCase() })} /></Field>
        <Field label={`Or store a key${s.firecrawl.hasKey ? ' (saved)' : ''}`}><input className="fx-input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.firecrawl.hasKey ? 'leave blank to keep' : 'fc-…'} aria-label="Firecrawl key" /></Field>
      </div>
      <span className="fx-small fx-muted">{s.firecrawl.envPresent ? `${s.firecrawl.keyEnv} is set on the server.` : s.firecrawl.hasKey ? 'A key is stored on the server.' : 'No Firecrawl key yet — get one at firecrawl.dev.'}</span>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="save" onClick={() => void saveS({ firecrawl: { ...fc, ...(key ? { key } : {}) } }).then(() => { setFc({}); setKey(''); setMsg('Saved'); })}>Save</Button>
        <Button icon="zap" onClick={() => void test()}>Test Firecrawl</Button>
      </div>
      {msg && <span className="fx-small">{msg}</span>}
      <label className="axp-agent-manager__toggle"><input type="checkbox" checked={s.scheduler} onChange={(e) => void saveS({ scheduler: e.target.checked })} /> Run scheduled training jobs in the background</label>
    </div>
  );
}

export function MemoryDefaultsPanel() {
  const { s, err, saveS } = useSettings();
  const [d, setD] = useState<Record<string, unknown>>({});
  if (err) return <p className="axp-agent-manager__bad">{err}</p>;
  if (!s) return <p className="fx-muted">Loading…</p>;
  const v = { ...s.defaults, ...d } as Settings['defaults'];
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Used by agents that don't set their own memory options.</p>
      <div className="axp-agent-manager__cols">
        <Field label="Memory type" hint={MEMORY_HELP[v.memoryType]}><select className="fx-input" value={v.memoryType} onChange={(e) => setD({ ...d, memoryType: e.target.value })}>{Object.keys(MEMORY_HELP).map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Recall top K"><Num value={v.topK} min={1} max={30} onChange={(topK) => setD({ ...d, topK })} /></Field>
        <Field label="Recent exchanges"><Num value={v.window} min={1} max={50} onChange={(window) => setD({ ...d, window })} /></Field>
        <Field label="Max items per agent"><Num value={v.maxItems} min={50} max={50000} onChange={(maxItems) => setD({ ...d, maxItems })} /></Field>
      </div>
      <div><Button tone="primary" icon="save" disabled={!Object.keys(d).length} onClick={() => void saveS({ defaults: d }).then(() => setD({}))}>Save</Button></div>
    </div>
  );
}

/** Settings → Safety: which agents may use dangerous tools (containers, writes, commands). Personas can't change this. */
export function SafetyPanel() {
  const { s, err, saveS } = useSettings();
  const { cache } = useData();
  if (err) return <p className="axp-agent-manager__bad">{err}</p>;
  if (!s || !cache) return <p className="fx-muted">Loading…</p>;
  const allowed = new Set(s.safety?.dangerousAgents ?? []);
  const flip = (id: string) => { const n = new Set(allowed); if (n.has(id)) n.delete(id); else n.add(id); void saveS({ safety: { dangerousAgents: [...n] } }); };
  const dangerous = cache.tools.filter((t) => t.dangerous || String((t.config as { builtin?: string }).builtin ?? '').startsWith('container_'));
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Dangerous tools touch the VPS containers, write files or run commands. Only the agents ticked here get them, whatever their persona or skills say. Every change they propose still needs your approval on a card, with a snapshot first.</p>
      <div className="fx-stack">
        {cache.agents.map((a) => (
          <label key={a.id} className="axp-agent-manager__toggle">
            <input type="checkbox" checked={allowed.has(a.id)} onChange={() => flip(a.id)} /> <Icon name={a.icon || 'user'} size={14} /> {a.name} <span className="fx-small fx-muted">{a.id}</span>
          </label>
        ))}
      </div>
      <p className="fx-small fx-muted">Dangerous tools: {dangerous.length ? dangerous.map((t) => t.name).join(', ') : 'none yet'}.</p>
    </div>
  );
}
