/**
 * AI assistant chat = Gizmo, moved from AmberX into the console (Brett, Nov 10 2026: "I need to get rid of the
 * assistant since we have Gizmo… move the Gizmo plugin that is the chat in AmberX to the console and be a console plugin
 * named AI assistant"). The old console chat is gone; this is Gizmo's Claude-style chat on the same engine
 * (assistant@1 live sessions on the console server), so a chat started here continues in AmberX and back.
 *
 *  - chats drawer: search, day groups, pin, rename, delete, new; replies stream and survive a reload (watchReply)
 *  - per chat: agent picker (any agent from the agents section, Gizmo by default; "Train agents…" opens that section)
 *    and model picker (Claude Opus / Fable, or a local Ollama model)
 *  - markdown + code, tool cards, write-mode approval cards, images and text files, edit and resend, regenerate, copy,
 *    read aloud, export; tools chip (Auto / Chat only / Tools on)
 *  - voice: push to talk and talk mode (./talk, Web Speech), plus the `assistant.mic` slot and the assistant voice
 *    bridge events (axf:assistant.agent / reply / input / focus / hello) for voice plugins
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { Button, Icon, IconButton, Markdown, Slot, useAxfState, useRuntime, useSlotFilled } from '@console/axf/react';
import { ApprovalsBadge } from '@console/axf/libs/approvals/react';
import { COMPANION, groupConversations, modelName, toolCard, type ToolCardView } from '@console/axf/libs/claude-session';
import { ChangeBatchCard, readEventStream, type Batch } from '@console/changeBatch';
import { pluginFetch } from '@console/plugins';
import { ActivityIcon, useReportActivity } from './activity';
import { MoreMenu } from './more';
import { currentChoice, findChoice, modelChoices, type ModelChoice } from './models';
import { ChatSettingsDialog } from './settings';
import { TALK_KEYS, canListen, pushToTalk, replyDone, replyStarted, resetSpeech, speakStreaming, startTalk, stopSpeaking, stopTalk, takeTalkRequest, talkState, useTalk } from './talk';
import {
  APPROVALS_BADGE_KEY, FOLDER, TOOL_MODES, call, client, configStore, consoleHub, emptyLiveReply, fileToImage, normalizeChatContext, post, statusStore, turnModeLabel, watchReply,
  type ConvSettings, type ConvSummary, type Conversation, type Ctx, type Image, type LiveReply, type Message, type Status, type ToolMode,
} from './api';

export function useStatus(): Status | undefined {
  useEffect(() => { if (!statusStore.get()) void statusStore.reload(); }, []);
  return useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
}
function useProfiles() {
  useEffect(() => { if (!configStore.get()) void configStore.reload(); }, []);
  const cfg = useSyncExternalStore(configStore.subscribe, configStore.get, configStore.get);
  return { profiles: cfg?.profiles ?? [], defaultProfile: cfg?.defaultProfile ?? '' };
}

/** `start`: open a fresh conversation (optionally with an agent / model) and send this message at once. */
export interface ChatStart { agentId?: string; message: string; title?: string; profileId?: string | null; model?: string | null }

const LAST = 'axf-ai-assistant:last';
const remember = (id: string) => { try { if (id) localStorage.setItem(LAST, id); else localStorage.removeItem(LAST); } catch { /* private mode */ } };
const recall = () => { try { return localStorage.getItem(LAST) ?? ''; } catch { return ''; } };
const snapshot = (r: LiveReply): LiveReply => ({ ...r, tools: r.tools.map((t) => ({ ...t })) });
const MODE_NAME: Record<ToolMode, string> = { auto: 'Auto', chat: 'Chat only', tools: 'Tools on' };
/** The window used last (voice input goes to it when several chats are open). */
let lastWindow = '';
interface TextFile { name: string; text: string }

function replyLine(m: Message): string {
  const n = m.meta?.tools?.length ?? 0;
  const first = m.meta?.firstWordMs;
  return [turnModeLabel(m.meta?.mode), n ? `${n} tool${n > 1 ? 's' : ''}` : '', first ? `${(first / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ');
}

const STARTERS = [
  { icon: 'hammer', label: "What's the crew building?", text: 'What is the crew building right now? Running builds, steps left, and anything stuck.' },
  { icon: 'branch', label: "How's main?", text: 'Is main green? Open PRs, CI state, and what is waiting to merge.' },
  { icon: 'eye', label: 'UI Review queue', text: 'What is waiting in UI Review for me? Open it.' },
  { icon: 'sparkles', label: 'Plan my next hour', text: 'Look at the pending builds and the plan and tell me the three things worth doing next.' },
];

function ToolCards({ tools, open, toggle }: { tools: ToolCardView[]; open: Set<string>; toggle: (id: string) => void }) {
  if (!tools.length) return null;
  return (
    <div className="axp-ai-assistant-chat__tools" data-axf-not-toolbar="list of tool-call cards in a reply, not a button row">
      {tools.map((t) => (
        <div key={t.id} className={`axp-ai-assistant-chat__tool axp-ai-assistant-chat__tool--${t.state}`}>
          <button type="button" data-fx-row className="axp-ai-assistant-chat__toolhead" aria-expanded={open.has(t.id)} onClick={() => toggle(t.id)}>
            <Icon name={open.has(t.id) ? 'chevron-down' : 'chevron-right'} size={12} />
            <Icon name={t.icon} size={12} />
            <span className="axp-ai-assistant-chat__clip">{t.title}</span>
            <Icon name={t.state === 'running' ? 'clock' : t.state === 'ok' ? 'check' : 'x-circle'} size={12} />
          </button>
          {open.has(t.id) && <pre className="axp-ai-assistant-chat__tooldetail fx-mono">{t.detail || '—'}</pre>}
        </div>
      ))}
    </div>
  );
}

/** The approval card for the change batch an agent proposed in a reply (change-batch@1, via axf.containers@1). */
function BatchFromId({ id }: { id: string }) {
  const rt = useRuntime();
  const [b, setB] = useState<Batch | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void call<Batch>(`batches/${encodeURIComponent(id)}`).then(setB, (e: Error) => setErr(e.message)); }, [id]);
  if (err) return <p className="fx-small fx-muted">Change batch {id}: {err}</p>;
  if (!b) return <p className="fx-small fx-muted">Loading the approval card…</p>;
  return (
    <ChangeBatchCard batch={b} actions={{
      approve: async (items, onEvent, opts) => {
        let last: Batch | null = null;
        const r = await pluginFetch(FOLDER, `batches/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ items, acceptUnseen: opts.acceptUnseen }) });
        await readEventStream(r, (e) => { if (e.type === 'batch' && e.batch) last = e.batch; onEvent(e); });
        return last;
      },
      reject: () => post<Batch>(`batches/${encodeURIComponent(id)}/reject`, {}),
      undo: () => post<Batch>(`batches/${encodeURIComponent(id)}/undo`, { confirm: 'undo' }),
      openSnapshot: rt.actions.get('snapshots.show') ? (sid: string) => rt.dispatch(`snapshots.show:${sid}`) : undefined,
    }} />
  );
}

export function AssistantChat({ compact = false, initialContext, onClose, start, openId }: { compact?: boolean; initialContext?: Ctx; onClose?: () => void; start?: ChatStart; openId?: string }) {
  const rt = useRuntime();
  const ax = useAxfState();
  const status = useStatus();
  const { profiles, defaultProfile } = useProfiles();
  const talk = useTalk();
  const [list, setList] = useState<ConvSummary[]>([]);
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [pending, setPending] = useState<ConvSettings>({});
  const [live, setLive] = useState<LiveReply | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<Image[]>([]);
  const [files, setFiles] = useState<TextFile[]>([]);
  const [editing, setEditing] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);
  const convId = useRef('');
  const viaVoice = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useReportActivity(live);

  const agents = status?.integrations.agents ? status.agents : [];
  const fallbackAgent = agents.find((a) => a.id === COMPANION.agentId)?.id ?? (agents.some((a) => a.id === status?.defaultAgent) ? status?.defaultAgent ?? '' : '');
  const settings: ConvSettings = conv?.settings ?? pending;
  const agentId = settings.agentId ?? (conv ? '' : fallbackAgent);
  const agent = agents.find((a) => a.id === agentId);
  const name = agent?.name ?? status?.assistantName ?? 'AI assistant';
  const choices = useMemo(() => modelChoices(profiles, defaultProfile), [profiles, defaultProfile]);
  const choice = currentChoice(choices, settings);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  const toolMode: ToolMode = settings.toolMode ?? status?.defaultToolMode ?? 'auto';

  /* ---- voice bridge (voice plugins follow this window through window events, never imports) */
  const winId = useRef(`w${Math.random().toString(36).slice(2, 9)}`);
  const agentRef = useRef({ id: '', name: '' });
  agentRef.current = { id: agent?.id ?? '', name };
  const voiceSlot = useSlotFilled('assistant.mic');
  const voiceProps = useMemo(() => ({ agentId: agent?.id ?? '', agentName: name, compact }), [agent?.id, name, compact]);
  const sendRef = useRef<(t?: string, voice?: boolean) => void>(() => undefined);
  const settingsRef = useRef<(s: Partial<ConvSettings>) => Promise<void>>(async () => undefined);
  useEffect(() => {
    const tell = () => window.dispatchEvent(new CustomEvent('axf:assistant.agent', { detail: { window: winId.current, agentId: agentRef.current.id, agentName: agentRef.current.name, open: true } }));
    tell();
    window.addEventListener('axf:assistant.hello', tell);
    return () => window.removeEventListener('axf:assistant.hello', tell);
  }, [agent?.id, name]);
  useEffect(() => {
    lastWindow = winId.current;
    const mine = () => lastWindow === winId.current;
    const onInput = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; send?: boolean }>).detail;
      if (!d || !mine()) return;
      const t = String(d.text ?? '');
      if (d.send && t.trim()) sendRef.current(t, true); else setText(t);
    };
    const onFocus = (e: Event) => { const id = (e as CustomEvent<{ agentId?: string }>).detail?.agentId; if (id && mine()) void settingsRef.current({ agentId: id }); };
    const onModel = (e: Event) => {
      const m = String((e as CustomEvent<{ model?: string }>).detail?.model ?? '');
      const c = findChoice(choicesRef.current, m);
      if (!mine()) return;
      if (c) void settingsRef.current({ profileId: c.settings.profileId, model: c.settings.model });
      else rt.toast(`No model "${m}" here (Claude Opus, Claude Fable or a local Ollama model).`, 'warning', 'AI assistant');
    };
    window.addEventListener('axf:ai-assistant.model', onModel);
    const onTalk = () => { if (mine() && takeTalkRequest() && !talkState().on) startTalk(rt, (t) => sendRef.current(t, true)); };
    window.addEventListener('axf:assistant.input', onInput);
    window.addEventListener('axf:assistant.focus', onFocus);
    window.addEventListener('axf:ai-assistant.talk', onTalk);
    onTalk();
    const w = winId.current;
    return () => {
      window.removeEventListener('axf:assistant.input', onInput);
      window.removeEventListener('axf:assistant.focus', onFocus);
      window.removeEventListener('axf:ai-assistant.talk', onTalk);
      window.removeEventListener('axf:ai-assistant.model', onModel);
      window.dispatchEvent(new CustomEvent('axf:assistant.agent', { detail: { window: w, open: false } }));
      if (lastWindow === w) { lastWindow = ''; stopTalk(); }
      abort.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadList = () => client.listConversations('').then(setList, (e: Error) => setErr(e.message));
  useEffect(() => {
    void loadList();
    if (start?.message) { void begin(start); return; }
    const id = openId || recall();
    if (id) void open(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [conv?.messages.length, live?.text, live?.tools.length]);

  const open = async (id: string, follow = true) => {
    if (follow && convId.current !== id) abort.current?.abort(); // switching detaches; the old reply keeps running on the host
    convId.current = id;
    try {
      const c = await client.getConversation(id);
      setConv(c); remember(id); setErr(''); setDrawer(false);
      if (follow) void attach(c);
    } catch { setConv(null); remember(''); }
  };
  const newChat = () => { abort.current?.abort(); convId.current = ''; setConv(null); setPending({}); remember(''); setEditing(''); setText(''); setDrawer(false); setTimeout(() => inputRef.current?.focus(), 30); };

  const updateSettings = async (s: Partial<ConvSettings>) => {
    if (!conv) { setPending((p) => ({ ...p, ...s })); return; }
    try { setConv(await client.patchConversation(conv.id, { settings: s })); } catch (e) { setErr((e as Error).message); }
  };
  settingsRef.current = updateSettings;
  const pickModel = (c: ModelChoice) => void updateSettings({ profileId: c.settings.profileId, model: c.settings.model });

  const ensureConv = async (): Promise<Conversation> => {
    if (conv) return conv;
    const s: ConvSettings = { ...pending };
    if (s.agentId === undefined && fallbackAgent) s.agentId = fallbackAgent;
    const c = await client.createConversation(s);
    setConv(c); remember(c.id); convId.current = c.id;
    return c;
  };

  const speakOn = () => viaVoice.current || talkState().on || rt.settings.get(TALK_KEYS.speakAlways) === true;
  const finish = async (cid: string, reply: LiveReply) => {
    abort.current = null;
    if (!reply.error && reply.text.trim()) {
      if (speakOn() && rt.settings.get(TALK_KEYS.speak) !== false) speakStreaming(rt, reply.text, true);
      window.dispatchEvent(new CustomEvent('axf:assistant.reply', { detail: { agentId: agentRef.current.id, agentName: agentRef.current.name || reply.agent, text: reply.text, convId: cid, viaVoice: viaVoice.current } }));
    } else if (reply.error && speakOn()) { resetSpeech(); speakStreaming(rt, reply.error, true); }
    viaVoice.current = false;
    replyDone();
    if (convId.current === cid) await open(cid, false);
    void loadList(); void statusStore.reload();
    if (reply.error) setErr(reply.error);
    setLive(null);
  };

  const run = async (body: Record<string, unknown>, optimistic?: Message, startWith?: Conversation) => {
    if (live) return;
    setErr('');
    let c: Conversation;
    try { c = startWith ?? await ensureConv(); } catch (e) { setErr((e as Error).message); viaVoice.current = false; replyDone(); return; }
    if (optimistic) {
      const msgs = body.editMessageId ? c.messages.slice(0, c.messages.findIndex((m) => m.id === body.editMessageId)) : c.messages;
      setConv({ ...c, messages: [...msgs, optimistic] });
    } else if (body.regenerate) {
      const msgs = [...c.messages];
      while (msgs.length && msgs[msgs.length - 1]?.role !== 'user') msgs.pop();
      setConv({ ...c, messages: msgs });
    }
    resetSpeech(); replyStarted();
    const speakLive = speakOn() && rt.settings.get(TALK_KEYS.speak) !== false;
    const reply = emptyLiveReply(`${name} is thinking…`, name);
    setLive(snapshot(reply));
    const ac = new AbortController();
    abort.current = ac;
    try {
      await watchReply(client, c.id, reply, (r) => { setLive(snapshot(r)); if (speakLive) speakStreaming(rt, r.text, false); }, (on, sig) => client.send(c.id, { ...body, toolMode }, on, sig), ac.signal);
    } catch (e) { reply.error = (e as Error).message; } finally { await finish(c.id, reply); }
  };

  /** A conversation whose reply is still running (another tab, AmberX, another device): follow it. */
  const attach = async (c: Conversation) => {
    const info = await client.session(c.id);
    if (!info || info.state !== 'running' || abort.current) return;
    const reply = emptyLiveReply('Following the running reply…', name);
    reply.lastSeq = Math.max(0, Number(info.meta?.turnSeq ?? info.lastSeq) - 1);
    setLive(snapshot(reply));
    const ac = new AbortController();
    abort.current = ac;
    try { await watchReply(client, c.id, reply, (r) => setLive(snapshot(r)), null, ac.signal); } finally { await finish(c.id, reply); }
  };

  /** ai.chat.start / ?start=…: a fresh chat with this agent / model, sending the message at once. */
  const begin = async (s: ChatStart) => {
    const set: ConvSettings = {};
    if (s.agentId) set.agentId = s.agentId; else if (fallbackAgent) set.agentId = fallbackAgent;
    if (s.profileId) set.profileId = s.profileId;
    if (s.model) set.model = s.model;
    try {
      const c = await client.createConversation(set, s.title);
      setConv(c); remember(c.id); convId.current = c.id;
      const opt: Message = { id: `tmp-${Date.now()}`, role: 'user', content: s.message, createdAt: Date.now() };
      void run({ content: s.message, context: normalizeChatContext(initialContext ?? { view: 'ai-assistant' }) ?? undefined }, opt, c);
    } catch (e) { setErr((e as Error).message); }
  };

  const stop = () => { stopSpeaking(); if (conv) void client.stop(conv.id); };
  const send = (override?: string, voice = false) => {
    let content = (override ?? text).trim();
    if (!content && !images.length && !files.length) return;
    if (files.length) content += files.map((f) => `\n\n\`\`\`${f.name}\n${f.text}\n\`\`\``).join('');
    const where: Ctx = initialContext ?? { view: ax.view || 'ai-assistant', title: document.title };
    const body: Record<string, unknown> = { content, images, context: normalizeChatContext({ ...where, extra: { appId: 'console-web', surface: voice ? 'voice' : 'chat' } }) ?? undefined };
    if (editing) body.editMessageId = editing;
    const opt: Message = { id: `tmp-${Date.now()}`, role: 'user', content, images, createdAt: Date.now() };
    viaVoice.current = voice;
    setText(''); setImages([]); setFiles([]); setEditing('');
    void run(body, opt);
  };
  sendRef.current = send;

  const addFiles = async (fl: FileList | File[]) => {
    for (const f of Array.from(fl).slice(0, 8)) {
      if (f.type.startsWith('image/')) {
        if (f.size > 6_000_000) { rt.toast(`${f.name} is over 6 MB`, 'warning', name); continue; }
        const img = await fileToImage(f);
        setImages((x) => [...x, img].slice(0, 6));
      } else if (f.size <= 300_000) {
        const t = await f.text();
        setFiles((x) => [...x, { name: f.name, text: t }]);
      } else rt.toast(`${f.name} is too large to attach as text (300 KB max)`, 'warning', name);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape' && live) stop();
    else if (e.key === 'Escape' && editing) { setEditing(''); setText(''); }
  };
  const cycleMode = () => { const next = TOOL_MODES[(TOOL_MODES.indexOf(toolMode) + 1) % TOOL_MODES.length] ?? 'auto'; void updateSettings({ toolMode: next }); };
  const pin = async (c: ConvSummary) => { await client.patchConversation(c.id, { pinned: !c.pinned }); void loadList(); };
  const rename = async () => {
    if (!renaming?.title.trim()) { setRenaming(null); return; }
    const c = await client.patchConversation(renaming.id, { title: renaming.title.trim() });
    if (conv?.id === c.id) setConv(c);
    setRenaming(null); void loadList();
  };
  const remove = async (c: ConvSummary) => {
    await client.deleteConversation(c.id);
    if (conv?.id === c.id) newChat();
    void loadList();
  };
  const exportConv = async () => {
    if (!conv) return;
    try {
      const r = await pluginFetch(FOLDER, `conversations/${encodeURIComponent(conv.id)}/export?format=md`);
      if (!r.ok) throw new Error(`Export failed (${r.status}).`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([await r.text()], { type: 'text/markdown' }));
      a.download = `${conv.title.replace(/[^\w-]+/g, '-').slice(0, 40) || 'chat'}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { rt.toast((e as Error).message, 'danger', name); }
  };
  const toggleTalk = () => { if (talk.on) stopTalk(); else startTalk(rt, (t) => sendRef.current(t, true)); };
  const ptt = () => pushToTalk(rt, (t) => sendRef.current(t, true));
  const toggleTool = (id: string) => setOpenTools((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const groups = useMemo(() => groupConversations(list, q), [list, q]);
  const visible = (conv?.messages ?? []).filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.meta?.step));
  const lastAssistant = [...visible].reverse().find((m) => m.role === 'assistant');
  const turnMode = turnModeLabel(live?.mode ?? lastAssistant?.meta?.mode);
  const toolsOf = (m: Message) => (m.meta?.tools ?? []).map((t) => toolCard({ ...t, done: true }));
  const canTrain = !!rt.actions.get('agents.open');

  if (status?.needsSetup) {
    return (
      <div className="axp-ai-assistant-chat axp-ai-assistant-chat--empty fx-stack">
        <Icon name="sparkles" size={28} />
        <h2>The AI assistant needs a provider</h2>
        <p className="fx-muted">Run the setup wizard (Claude plan, or a local Ollama), then come back.</p>
        <Button tone="primary" icon="settings" onClick={() => rt.dispatch('settings.open:ai-assistant')}>Set it up</Button>
      </div>
    );
  }

  return (
    <div className={`axp-ai-assistant-chat ${compact ? 'axp-ai-assistant-chat--compact' : ''}`} data-talk={talk.phase}>
      <header className="axp-ai-assistant-chat__bar" role="toolbar" aria-label="Chat">
        <IconButton icon="menu" label="Chats" aria-expanded={drawer} onClick={() => setDrawer((d) => !d)} />
        <div className="axp-ai-assistant-chat__title">
          <ActivityIcon icon={agent?.icon || 'sparkles'} size={16} />
          <strong className="axp-ai-assistant-chat__clip">{conv?.title || name}</strong>
          {live && <span className="fx-muted axp-ai-assistant-chat__clip">{live.status || 'typing…'}</span>}
        </div>
        {agents.length > 0 && (
          <MoreMenu label="Agent" icon="users" text={agent?.name ?? 'No agent'} items={[
            { label: 'No agent (plain assistant)', checked: !agent, onPick: () => void updateSettings({ agentId: '' }) },
            ...agents.map((a) => ({ label: a.name, title: a.description, checked: a.id === agent?.id, onPick: () => void updateSettings({ agentId: a.id }) })),
            canTrain && { label: 'Train and edit agents…', icon: 'layers', onPick: () => { onClose?.(); rt.dispatch('agents.open'); } },
          ]} />
        )}
        {choices.length > 0 && (
          <MoreMenu label="Model" icon={choice?.family === 'local' ? 'cpu' : 'sparkles'} text={choice?.label ?? 'Model'} items={choices.map((c) => ({ label: c.label, checked: c.key === choice?.key, onPick: () => pickModel(c) }))} />
        )}
        {rt.settings.get(APPROVALS_BADGE_KEY) !== false && <ApprovalsBadge resolveHub={consoleHub} frame className="axp-ai-assistant-chat__approvals" />}
        <Slot name="assistant.head" props={voiceProps} />
        <MoreMenu items={[
          { label: 'Chat settings', icon: 'sliders', onPick: () => setSheet(true) },
          { label: 'Export this chat', icon: 'download', disabled: !conv, onPick: () => void exportConv() },
          !compact && { label: 'Open in a window', icon: 'monitor', onPick: () => rt.dispatch('ai-assistant.open') },
          compact && { label: 'Open the full page', icon: 'external', onPick: () => { onClose?.(); rt.navigate('ai-assistant'); } },
          { label: 'Assistant settings', icon: 'settings', onPick: () => { onClose?.(); rt.dispatch('settings.open:ai-assistant'); } },
        ]} />
        <IconButton icon="plus" label="New chat" onClick={newChat} />
      </header>

      {drawer && (
        <aside className="axp-ai-assistant-chat__drawer" aria-label="Chats">
          <div className="axp-ai-assistant-chat__drawerhead">
            <input className="fx-input axp-ai-assistant-chat__grow" type="search" value={q} placeholder="Search chats" aria-label="Search chats" onChange={(e) => setQ(e.target.value)} />
            <Button tone="primary" size="sm" icon="plus" onClick={newChat}>New</Button>
          </div>
          <div className="axp-ai-assistant-chat__drawerlist">
            {!groups.length && <p className="fx-muted axp-ai-assistant-chat__pad">{q ? 'No chat matches.' : `No chats yet. Say hi to ${name}.`}</p>}
            {groups.map((g) => (
              <section key={g.group} className="axp-ai-assistant-chat__group">
                <h4 className="fx-eyebrow">{g.group}</h4>
                {g.items.map((c) => (
                  <div key={c.id} className={`axp-ai-assistant-chat__row ${c.id === conv?.id ? 'is-active' : ''}`}>
                    {renaming?.id === c.id ? (
                      <input className="fx-input axp-ai-assistant-chat__grow" autoFocus value={renaming.title} aria-label="Chat name" onChange={(e) => setRenaming({ id: c.id, title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setRenaming(null); }} onBlur={() => void rename()} />
                    ) : (
                      <button type="button" data-fx-row className="axp-ai-assistant-chat__rowmain" onClick={() => void open(c.id)}>
                        <span className="axp-ai-assistant-chat__clip">{c.pinned ? '★ ' : ''}{c.title}</span>
                        <span className="fx-muted axp-ai-assistant-chat__clip">{c.preview}</span>
                      </button>
                    )}
                    <MoreMenu label={`Chat ${c.title}`} items={[
                      { label: c.pinned ? 'Unpin' : 'Pin', icon: 'star', onPick: () => void pin(c) },
                      { label: 'Rename', icon: 'edit', onPick: () => setRenaming({ id: c.id, title: c.title }) },
                      { label: 'Delete', icon: 'trash', danger: true, onPick: () => void remove(c) },
                    ]} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </aside>
      )}

      <main className="axp-ai-assistant-chat__log" aria-live="polite">
        {!visible.length && !live && (
          <div className="axp-ai-assistant-chat__hello fx-stack">
            <Icon name="sparkles" size={32} />
            <h2>Hey Brett, it's {name}.</h2>
            <p className="fx-muted">{agent?.id === COMPANION.agentId ? COMPANION.tagline : agent?.description || 'Ask anything; I can open screens, change settings and file builds for you.'}</p>
            <div className="axp-ai-assistant-chat__starters">
              {STARTERS.map((s) => <Button key={s.label} size="sm" icon={s.icon} onClick={() => send(s.text)}>{s.label}</Button>)}
            </div>
          </div>
        )}
        {visible.map((m) => (
          <article key={m.id} className={`axp-ai-assistant-chat__msg axp-ai-assistant-chat__msg--${m.role}`}>
            {m.images?.length ? <div className="axp-ai-assistant-chat__imgs">{m.images.map((im, i) => <img key={i} alt={im.name ?? 'attached image'} src={`data:${im.media_type};base64,${im.data}`} />)}</div> : null}
            {m.role === 'assistant' ? <Markdown text={m.content} /> : <p className="axp-ai-assistant-chat__usertext">{m.content}</p>}
            {m.role === 'assistant' && <ToolCards tools={toolsOf(m)} open={openTools} toggle={toggleTool} />}
            {m.role === 'assistant' && typeof m.meta?.batch === 'string' && <BatchFromId id={m.meta.batch} />}
            <div className="axp-ai-assistant-chat__msgtools" role="toolbar" aria-label="Message">
              <IconButton icon="copy" label="Copy" onClick={() => { void navigator.clipboard?.writeText(m.content); rt.toast('Copied', 'success', name); }} />
              {m.role === 'user' && !live && <IconButton icon="edit" label="Edit and resend" onClick={() => { setEditing(m.id); setText(m.content); inputRef.current?.focus(); }} />}
              {m.role === 'assistant' && <IconButton icon="volume" label="Read aloud" onClick={() => { resetSpeech(); speakStreaming(rt, m.content, true); }} />}
              {m.id === lastAssistant?.id && !live && <IconButton icon="refresh" label="Regenerate" onClick={() => void run({ regenerate: true })} />}
              {(m.meta?.model || m.role === 'assistant') && <span className="fx-muted axp-ai-assistant-chat__clip">{[m.meta?.model ? modelName(m.meta.model) : '', m.role === 'assistant' ? replyLine(m) : ''].filter(Boolean).join(' · ')}</span>}
            </div>
          </article>
        ))}
        {live && (
          <article className="axp-ai-assistant-chat__msg axp-ai-assistant-chat__msg--assistant" aria-busy="true">
            {live.text ? <Markdown text={live.text} /> : <p className="fx-muted">{live.status || `${name} is thinking…`}</p>}
            <ToolCards tools={live.tools.map(toolCard)} open={openTools} toggle={toggleTool} />
            {live.error && <p className="axp-ai-assistant-chat__note axp-ai-assistant-chat__note--danger">{live.error}</p>}
          </article>
        )}
        {err && <p className="axp-ai-assistant-chat__note axp-ai-assistant-chat__note--danger">{err}</p>}
        <div ref={endRef} />
      </main>

      <footer className="axp-ai-assistant-chat__composer">
        {talk.on && (
          <div className="axp-ai-assistant-chat__talk" data-talk-phase={talk.phase}>
            <Icon name="mic" size={14} />
            <span className="axp-ai-assistant-chat__clip">{talk.phase === 'listening' ? (talk.heard || `Listening… talk to ${name}`) : talk.phase === 'thinking' ? `“${talk.heard}”` : talk.phase === 'speaking' ? `${name} is talking (say “stop” to cut in)` : ''}</span>
            {talk.phase === 'speaking' && <Button size="sm" icon="x" onClick={stopSpeaking}>Quiet</Button>}
          </div>
        )}
        {talk.note && <p className="axp-ai-assistant-chat__note">{talk.note}</p>}
        {editing && <p className="axp-ai-assistant-chat__note">Editing a message: send to replace it and everything after. <Button size="sm" icon="x" onClick={() => { setEditing(''); setText(''); }}>Cancel</Button></p>}
        {(images.length > 0 || files.length > 0) && (
          <div className="axp-ai-assistant-chat__attached">
            {images.map((im, i) => <span key={`i${i}`} className="fx-chip">{im.name ?? 'image'} <IconButton icon="x" label="Remove" onClick={() => setImages((x) => x.filter((_, j) => j !== i))} /></span>)}
            {files.map((f, i) => <span key={`f${i}`} className="fx-chip">{f.name} <IconButton icon="x" label="Remove" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} /></span>)}
          </div>
        )}
        <textarea ref={inputRef} className="fx-input axp-ai-assistant-chat__input" rows={2} value={text} placeholder={`Message ${name}`} aria-label={`Message ${name}`}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={(e) => { const fl = Array.from(e.clipboardData.files); if (fl.length) { e.preventDefault(); void addFiles(fl); } }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void addFiles(e.dataTransfer.files); } }} />
        <div className="axp-ai-assistant-chat__inputrow" role="toolbar" aria-label="Message box">
          <IconButton icon="upload" label="Attach a file or image" onClick={() => fileRef.current?.click()} />
          <input ref={fileRef} type="file" multiple hidden accept="image/*,text/*,.md,.json,.ts,.tsx,.js,.mjs,.py,.kt,.css,.html,.yml,.yaml,.log,.csv" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
          <Button size="sm" icon={(live?.mode ?? lastAssistant?.meta?.mode)?.mode === 'tools' ? 'zap' : 'sparkles'} className="axp-ai-assistant-chat__mode" title={`Tools: ${MODE_NAME[toolMode]}${turnMode ? `. This turn: ${turnMode}` : ''}. Click to change.`} onClick={cycleMode}>
            <span className="axp-ai-assistant-chat__clip">{toolMode === 'auto' && turnMode ? `Auto · ${turnMode}` : MODE_NAME[toolMode]}</span>
          </Button>
          <span className="axp-ai-assistant-chat__grow" />
          {voiceSlot && <Slot name="assistant.mic" props={voiceProps} />}
          {canListen() && <IconButton icon="mic" label="Push to talk" onClick={ptt} disabled={!!live} />}
          <IconButton icon={talk.on ? 'pause' : 'play'} label={talk.on ? 'Leave voice chat' : 'Voice chat (hands-free)'} aria-pressed={talk.on} onClick={toggleTalk} />
          {live ? <Button tone="danger" size="sm" icon="x-circle" onClick={stop}>Stop</Button> : <Button tone="primary" size="sm" icon="arrow-right" onClick={() => send()} disabled={!text.trim() && !images.length && !files.length}>Send</Button>}
        </div>
      </footer>
      {sheet && <ChatSettingsDialog settings={settings} onChange={updateSettings} onClose={() => setSheet(false)} onOpenFull={() => { setSheet(false); onClose?.(); rt.dispatch('settings.open:ai-assistant'); }} />}
    </div>
  );
}
