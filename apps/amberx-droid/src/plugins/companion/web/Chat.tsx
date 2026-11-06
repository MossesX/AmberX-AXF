/**
 * Gizmo — the companion's full-screen chat (phone first). Chats are assistant@1 live sessions on the VPS (see ./api):
 * replies stream in and survive a dropped connection or a closed app (opening the chat again re-attaches), stop works
 * from any device. Markdown with copyable code blocks, photos / images / text files attached, edit a message and
 * resend, regenerate, copy, read aloud; the conversation list (search, pinned, day groups, rename, pin, delete, new) is
 * a drawer. Talk mode (./talk) sends what Brett says and speaks the reply as it streams.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Icon, IconButton, Markdown, WindowGrip, useAxfState, useRuntime, useWindowFrame } from '../../../axf/react';
import {
  TOOL_MODES, emptyLiveReply, normalizeChatContext, turnModeLabel, watchReply,
  type AgentRef, type AssistantStatus, type ChatImage, type Conversation, type ConversationSettings, type ConversationSummary, type LiveReply, type Message, type ToolMode,
} from '../../../axf/core';
import { COMPANION, budgetState, chatModelId, chatModels, groupConversations, modelName, money, toolCard, tokenCost, type ToolCardView } from '../../../axf/libs/claude-session';
import pricing from '../../../axf/schemas/model-pricing.json';
import { client, download, exportText, fileToImage, usage } from './api';
import { K } from './keys';
import { forgetChat, mirrorChat } from './mirror';
import { pushToTalk, replyDone, replyStarted, resetSpeech, speakStreaming, startTalk, stopSpeaking, stopTalk, takeTalkRequest, talkState, useTalk } from './talk';

const LAST = 'companion.last';
const remember = (id: string) => { try { if (id) localStorage.setItem(LAST, id); else localStorage.removeItem(LAST); } catch { /* private mode */ } };
const recall = () => { try { return localStorage.getItem(LAST) ?? ''; } catch { return ''; } };
const snapshot = (r: LiveReply): LiveReply => ({ ...r, tools: r.tools.map((t) => ({ ...t })) });
const MODE_NAME: Record<ToolMode, string> = { auto: 'Auto', chat: 'Chat only', tools: 'Tools on' };
/** A reply's footer: how it ran, what it used, how fast the first word came. */
function replyLine(m: Message): string {
  const n = m.meta?.tools?.length ?? 0;
  const first = m.meta?.firstWordMs;
  return [turnModeLabel(m.meta?.mode), n ? `${n} tool${n > 1 ? 's' : ''}` : '', first ? `${(first / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ');
}
interface TextFile { name: string; text: string }

/** Starters on an empty chat: each one is a question for Gizmo. */
const STARTERS = [
  { icon: 'hammer', label: "What's the crew building?", text: 'What is the crew building right now? Running builds, steps left, and anything stuck.' },
  { icon: 'branch', label: "How's main?", text: 'Is main green? Open PRs, CI state, and what is waiting to merge.' },
  { icon: 'eye', label: 'UI Review queue', text: 'What is waiting in UI Review for me?' },
  { icon: 'sparkles', label: 'Plan my next hour', text: 'Look at the pending builds and the plan and tell me the three things worth doing next.' },
];

function useStatus() {
  const [s, setS] = useState<AssistantStatus | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { let on = true; client.status().then((x) => { if (on) setS(x); }, (e: Error) => { if (on) setErr(e.message); }); return () => { on = false; }; }, []);
  return { status: s, error: err };
}

function ToolCards({ tools, open, toggle }: { tools: ToolCardView[]; open: Set<string>; toggle: (id: string) => void }) {
  if (!tools.length) return null;
  return (
    <div className="axp-companion__tools" data-axf-not-toolbar="list of tool-call cards in a reply, not a button row">
      {tools.map((t) => (
        <div key={t.id} className={`axp-companion__tool axp-companion__tool--${t.state}`}>
          <button type="button" data-fx-row className="axp-companion__toolhead" aria-expanded={open.has(t.id)} onClick={() => toggle(t.id)}>
            <Icon name={open.has(t.id) ? 'chevron-down' : 'chevron-right'} size={12} />
            <Icon name={t.icon} size={12} />
            <span className="axp-companion__clip">{t.title}</span>
            <Icon name={t.state === 'running' ? 'clock' : t.state === 'ok' ? 'check' : 'x-circle'} size={12} />
          </button>
          {open.has(t.id) && <pre className="axp-companion__tooldetail fx-mono">{t.detail || '—'}</pre>}
        </div>
      ))}
    </div>
  );
}

export function CompanionView() {
  const rt = useRuntime();
  useAxfState();
  // frameless window (like the console's Terminal): the chat's title bar is the window's title bar. Empty bar space
  // drags (double-tap maximizes); caption buttons at its end in Windows order. In the main shell there is no frame.
  const frame = useWindowFrame();
  const barDown = (e: React.PointerEvent) => { if (!frame || (e.target as HTMLElement).closest('button, input, [role="radiogroup"], .fx-window__grip')) return; frame.startMove(e); };
  const { status, error: statusErr } = useStatus();
  const talk = useTalk();
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [live, setLive] = useState<LiveReply | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [files, setFiles] = useState<TextFile[]>([]);
  const [editing, setEditing] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [spentUsd, setSpent] = useState(0);
  const [newMode, setNewMode] = useState<ToolMode | ''>('');
  const abort = useRef<AbortController | null>(null);
  const convId = useRef('');
  const viaVoice = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const gizmo: AgentRef | undefined = status?.agents.find((a) => a.id === COMPANION.agentId);
  const pickedModel = String(rt.settings.get(K.model) ?? '');
  const capUsd = Number(rt.settings.get(K.dailyCapUsd) ?? 0);
  const budget = budgetState(spentUsd, capUsd);
  const showTools = rt.settings.get(K.showTools) !== false;
  const models = chatModels();
  const savedMode = String(rt.settings.get(K.toolMode) ?? 'auto');
  const toolMode: ToolMode = conv?.settings.toolMode ?? (newMode || (TOOL_MODES.includes(savedMode as ToolMode) ? savedMode as ToolMode : 'auto'));

  const loadList = () => client.listConversations('').then((items) => setList(items.filter((c) => !c.agentId || c.agentId === COMPANION.agentId)), (e: Error) => setErr(e.message));
  const loadSpend = () => usage().then((u) => setSpent(tokenCost(u.today, chatModelId(pickedModel) || 'opus', pricing as { models: Record<string, { input: number; output: number }> })), () => undefined);
  useEffect(() => { void loadList(); void loadSpend(); const last = recall(); if (last) void open(last); return () => { abort.current?.abort(); stopTalk(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [conv?.messages.length, live?.text, live?.tools.length]);

  const open = async (id: string, follow = true) => {
    if (follow && convId.current !== id) abort.current?.abort(); // switching detaches; the old reply keeps running on the VPS
    convId.current = id;
    try {
      const c = await client.getConversation(id);
      setConv(c); remember(id); setErr(''); setDrawer(false);
      if (follow) void attach(c);
    } catch { setConv(null); remember(''); }
  };
  const newChat = () => { abort.current?.abort(); convId.current = ''; setConv(null); remember(''); setEditing(''); setText(''); setDrawer(false); setNewMode(''); setTimeout(() => inputRef.current?.focus(), 30); };

  const settingsForNew = (): ConversationSettings => {
    const persona = String(rt.settings.get(K.persona) ?? '').trim();
    return {
      ...(gizmo ? { agentId: gizmo.id } : {}),
      ...(chatModelId(pickedModel) ? { model: chatModelId(pickedModel) } : {}),
      ...(persona ? { systemPrompt: persona } : {}),
      tools: rt.settings.get(K.tools) !== false,
      toolMode,
    };
  };
  const ensureConv = async (): Promise<Conversation> => {
    if (conv) return conv;
    const c = await client.createConversation(settingsForNew());
    setConv(c); remember(c.id); convId.current = c.id;
    return c;
  };

  const finish = async (cid: string, reply: LiveReply) => {
    abort.current = null;
    if (!reply.error && reply.text.trim()) {
      if (viaVoice.current || talk.on || rt.settings.get(K.speakAlways) === true) speakStreaming(rt, reply.text, true);
      if (rt.settings.get(K.notify) !== false && document.visibilityState !== 'visible') rt.toast(`Gizmo answered: ${reply.text.slice(0, 80)}`, 'info', 'Gizmo');
    }
    if (reply.error && (viaVoice.current || talk.on)) { resetSpeech(); speakStreaming(rt, reply.error, true); } // hands-free: he isn't looking at the screen
    viaVoice.current = false;
    replyDone(rt);
    if (convId.current === cid) {
      await open(cid, false);
      if (rt.settings.get(K.mirror) !== false) void client.getConversation(cid).then(mirrorChat, () => undefined);
    }
    void loadList(); void loadSpend();
    if (reply.error) setErr(reply.error);
    setLive(null);
  };

  const run = async (body: Record<string, unknown>, optimistic?: Message) => {
    if (live) return;
    if (budget.level === 'over') { setErr(`Today's cap (${money(capUsd)}) is reached. Raise it in Settings → Plugins → Gizmo.`); return; }
    setErr('');
    let c: Conversation;
    try { c = await ensureConv(); } catch (e) { setErr((e as Error).message); return; }
    if (optimistic) {
      const msgs = body.editMessageId ? c.messages.slice(0, c.messages.findIndex((m) => m.id === body.editMessageId)) : c.messages;
      setConv({ ...c, messages: [...msgs, optimistic] });
    } else if (body.regenerate) {
      const msgs = [...c.messages];
      while (msgs.length && msgs[msgs.length - 1]?.role !== 'user') msgs.pop();
      setConv({ ...c, messages: msgs });
    }
    resetSpeech(); replyStarted();
    const speakLive = viaVoice.current || talk.on || rt.settings.get(K.speakAlways) === true;
    const reply = emptyLiveReply('Gizmo is thinking…', COMPANION.name);
    setLive(snapshot(reply));
    const ac = new AbortController();
    abort.current = ac;
    try {
      await watchReply(client, c.id, reply, (r) => { setLive(snapshot(r)); if (speakLive) speakStreaming(rt, r.text, false); }, (on, sig) => client.send(c.id, body, on, sig), ac.signal);
    } catch (e) { reply.error = (e as Error).message; } finally { await finish(c.id, reply); }
  };

  /** A conversation whose reply is still running (here, another tab, another device): follow it. */
  const attach = async (c: Conversation) => {
    const info = await client.session(c.id);
    if (!info || info.state !== 'running' || abort.current) return;
    const reply = emptyLiveReply('Following the running reply…', COMPANION.name);
    reply.lastSeq = Math.max(0, Number(info.meta?.turnSeq ?? info.lastSeq) - 1);
    setLive(snapshot(reply));
    const ac = new AbortController();
    abort.current = ac;
    try { await watchReply(client, c.id, reply, (r) => setLive(snapshot(r)), null, ac.signal); } finally { await finish(c.id, reply); }
  };

  const stop = () => { stopSpeaking(); if (conv) void client.stop(conv.id); };

  const send = (override?: string, voice = false) => {
    let content = (override ?? text).trim();
    if (!content && !images.length && !files.length) return;
    if (files.length) content += files.map((f) => `\n\n\`\`\`${f.name}\n${f.text}\n\`\`\``).join('');
    const body: Record<string, unknown> = { content, images, context: normalizeChatContext({ view: 'companion', title: 'Gizmo (AmberX)', extra: { appId: 'amberx-droid', surface: voice ? 'voice' : 'chat' } }) ?? undefined };
    if (editing) body.editMessageId = editing;
    const opt: Message = { id: `tmp-${Date.now()}`, role: 'user', content, images, createdAt: Date.now() };
    viaVoice.current = voice;
    setText(''); setImages([]); setFiles([]); setEditing('');
    void run(body, opt);
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  const addFiles = async (fl: FileList | File[]) => {
    for (const f of Array.from(fl).slice(0, 8)) {
      if (f.type.startsWith('image/')) {
        if (f.size > 6_000_000) { rt.toast(`${f.name} is over 6 MB`, 'warning', 'Gizmo'); continue; }
        const img = await fileToImage(f);
        setImages((x) => [...x, img].slice(0, 6));
      } else if (f.size <= 300_000) {
        const t = await f.text();
        setFiles((x) => [...x, { name: f.name, text: t }]);
      } else rt.toast(`${f.name} is too large to attach as text (300 KB max)`, 'warning', 'Gizmo');
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape' && live) stop();
    else if (e.key === 'Escape' && editing) { setEditing(''); setText(''); }
  };

  const setModel = async (key: string) => {
    rt.settings.set(K.model, key);
    if (conv) setConv(await client.patchConversation(conv.id, { settings: { model: chatModelId(key) } }));
  };
  const cycleMode = async () => {
    const next = TOOL_MODES[(TOOL_MODES.indexOf(toolMode) + 1) % TOOL_MODES.length] ?? 'auto';
    setNewMode(next);
    if (conv) setConv(await client.patchConversation(conv.id, { settings: { toolMode: next } }));
  };
  const pin = async (c: ConversationSummary) => { await client.patchConversation(c.id, { pinned: !c.pinned }); void loadList(); };
  const rename = async () => {
    if (!renaming?.title.trim()) { setRenaming(null); return; }
    const c = await client.patchConversation(renaming.id, { title: renaming.title.trim() });
    if (conv?.id === c.id) setConv(c);
    setRenaming(null); void loadList();
  };
  const remove = async (c: ConversationSummary) => {
    if (!globalThis.confirm?.(`Delete “${c.title}”? This removes it from the VPS and its copy on axHub.`)) return;
    await client.deleteConversation(c.id); void forgetChat(c.id);
    if (conv?.id === c.id) newChat();
    void loadList();
  };
  const exportConv = async () => {
    if (!conv) return;
    try { download(`${conv.title.replace(/[^\w-]+/g, '-').slice(0, 40) || 'gizmo-chat'}.md`, await exportText(conv.id, 'md'), 'text/markdown'); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Gizmo'); }
  };
  const toggleTalk = () => { if (talk.on) stopTalk(); else startTalk(rt, (t) => sendRef.current(t, true)); };
  const ptt = () => void pushToTalk(rt, (t) => sendRef.current(t, true));
  useEffect(() => {
    const go = () => { if (takeTalkRequest() && !talkState().on) startTalk(rt, (t) => sendRef.current(t, true)); };
    go();
    window.addEventListener('axf:companion.talk', go);
    return () => window.removeEventListener('axf:companion.talk', go);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTool = (id: string) => setOpenTools((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const groups = useMemo(() => groupConversations(list, q), [list, q]);
  const visible = (conv?.messages ?? []).filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.meta?.step));
  const lastAssistant = [...visible].reverse().find((m) => m.role === 'assistant');
  const convModel = conv?.settings.model ?? chatModelId(pickedModel);
  const modelKey = models.find((m) => m.id === convModel)?.key ?? models[0]?.key ?? 'opus';
  const turnMode = turnModeLabel(live?.mode ?? lastAssistant?.meta?.mode);
  const toolsOf = (m: Message) => (m.meta?.tools ?? []).map((t) => toolCard({ ...t, done: true }));

  if (status?.needsSetup) {
    return (
      <div className="axp-companion axp-companion--empty fx-stack">
        <Icon name="sparkles" size={28} />
        <h2>Gizmo needs the assistant set up</h2>
        <p className="fx-muted">The Dev Console's AI assistant has no provider yet. Set it up on the console (Settings → Plugins → AI assistant, Claude plan), then come back.</p>
      </div>
    );
  }

  return (
    <div className={`axp-companion axp-companion--wt ${frame ? 'axp-companion--window' : ''}`} data-talk={talk.phase}>
      <header className={`axp-companion__bar ${frame ? 'axp-companion__bar--titlebar' : ''}`} onPointerDown={barDown}>
        {frame && <WindowGrip className="axp-companion__grip" />}
        <IconButton icon="menu" label="Chats" onClick={() => setDrawer((d) => !d)} />
        <div className="axp-companion__title">
          <Icon name="sparkles" size={16} />
          <strong className="axp-companion__clip">{conv?.title || COMPANION.name}</strong>
          {live && <span className="fx-muted axp-companion__clip">{live.status || 'typing…'}</span>}
        </div>
        <div className="fx-seg" role="radiogroup" aria-label="Model">
          {models.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={m.key === modelKey} className={`fx-seg__opt ${m.key === modelKey ? 'is-active' : ''}`} onClick={() => void setModel(m.key)}>{modelName(m.id).split(' ')[0]}</button>
          ))}
        </div>
        <IconButton icon="download" label="Export this chat" onClick={() => void exportConv()} disabled={!conv} />
        <IconButton icon="plus" label="New chat" onClick={newChat} />
        {!frame && <IconButton icon="external" label="Open in a window" onClick={() => rt.dispatch('companion.open')} />}
        {frame && (
          <div className="axp-companion__caption" role="group" aria-label="Window">
            {frame.canMinimize && <button type="button" className="fx-iconbtn axp-companion__cap" title="Minimize" aria-label="Minimize" onPointerDown={(e) => e.stopPropagation()} onClick={frame.minimize}><Icon name="minimize" size={14} /></button>}
            <button type="button" className="fx-iconbtn axp-companion__cap" title={frame.maximized ? 'Restore down' : 'Maximize'} aria-label={frame.maximized ? 'Restore down' : 'Maximize'} onPointerDown={(e) => e.stopPropagation()} onClick={frame.toggleMaximize}><Icon name={frame.maximized ? 'restore' : 'maximize'} size={13} /></button>
            {frame.w.closable && <button type="button" className="fx-iconbtn axp-companion__cap" title="Close" aria-label="Close window" onPointerDown={(e) => e.stopPropagation()} onClick={frame.close}><Icon name="x" size={14} /></button>}
          </div>
        )}
      </header>

      {drawer && (
        <aside className="axp-companion__drawer" aria-label="Chats">
          <div className="axp-companion__drawerhead">
            <input className="fx-input axp-companion__grow" type="search" value={q} placeholder="Search chats" aria-label="Search chats" onChange={(e) => setQ(e.target.value)} />
            <Button tone="primary" size="sm" icon="plus" onClick={newChat}>New</Button>
          </div>
          <div className="axp-companion__drawerlist">
            {!groups.length && <p className="fx-muted axp-companion__pad">{q ? 'No chat matches.' : 'No chats yet. Say hi to Gizmo.'}</p>}
            {groups.map((g) => (
              <section key={g.group} className="axp-companion__group">
                <h4 className="fx-eyebrow">{g.group}</h4>
                {g.items.map((c) => (
                  <div key={c.id} className={`axp-companion__row ${c.id === conv?.id ? 'is-active' : ''}`}>
                    {renaming?.id === c.id ? (
                      <input className="fx-input axp-companion__grow" autoFocus value={renaming.title} aria-label="Chat name" onChange={(e) => setRenaming({ id: c.id, title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setRenaming(null); }} onBlur={() => void rename()} />
                    ) : (
                      <button type="button" data-fx-row className="axp-companion__rowmain" onClick={() => void open(c.id)}>
                        <span className="axp-companion__clip">{c.pinned ? '★ ' : ''}{c.title}</span>
                        <span className="fx-muted axp-companion__clip">{c.preview}</span>
                      </button>
                    )}
                    <IconButton icon="star" label={c.pinned ? 'Unpin' : 'Pin'} onClick={() => void pin(c)} />
                    <IconButton icon="edit" label="Rename" onClick={() => setRenaming({ id: c.id, title: c.title })} />
                    <IconButton icon="trash" label="Delete" onClick={() => void remove(c)} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </aside>
      )}

      <main className="axp-companion__log" aria-live="polite">
        {statusErr && <p className="axp-companion__note axp-companion__note--danger">{statusErr}</p>}
        {status && !gizmo && <p className="axp-companion__note">Gizmo's agent isn't on the console yet (Agent manager installs him on its next start); chatting with the plain assistant until then.</p>}
        {!visible.length && !live && (
          <div className="axp-companion__hello fx-stack">
            <Icon name="sparkles" size={32} />
            <h2>Hey Brett, it's {COMPANION.name}.</h2>
            <p className="fx-muted">{COMPANION.tagline}</p>
            <div className="axp-companion__starters">
              {STARTERS.map((s) => <Button key={s.label} size="sm" icon={s.icon} onClick={() => send(s.text)}>{s.label}</Button>)}
            </div>
          </div>
        )}
        {visible.map((m) => (
          <article key={m.id} className={`axp-companion__msg axp-companion__msg--${m.role}`}>
            {m.images?.length ? <div className="axp-companion__imgs">{m.images.map((im, i) => <img key={i} alt={im.name ?? 'attached image'} src={`data:${im.media_type};base64,${im.data}`} />)}</div> : null}
            {m.role === 'assistant' ? <Markdown text={m.content} /> : <p className="axp-companion__usertext">{m.content}</p>}
            {m.role === 'assistant' && showTools && <ToolCards tools={toolsOf(m)} open={openTools} toggle={toggleTool} />}
            <div className="axp-companion__msgtools">
              <IconButton icon="copy" label="Copy" onClick={() => { void navigator.clipboard?.writeText(m.content); rt.toast('Copied', 'success', 'Gizmo'); }} />
              {m.role === 'user' && !live && <IconButton icon="edit" label="Edit and resend" onClick={() => { setEditing(m.id); setText(m.content); inputRef.current?.focus(); }} />}
              {m.role === 'assistant' && <IconButton icon="mic" label="Read aloud" onClick={() => { resetSpeech(); speakStreaming(rt, m.content, true); }} />}
              {m.id === lastAssistant?.id && !live && <IconButton icon="refresh" label="Regenerate" onClick={() => void run({ regenerate: true })} />}
              {m.meta?.model && <span className="fx-muted">{modelName(m.meta.model)}</span>}
              {m.role === 'assistant' && replyLine(m) && <span className="fx-muted axp-companion__clip">{replyLine(m)}</span>}
            </div>
          </article>
        ))}
        {live && (
          <article className="axp-companion__msg axp-companion__msg--assistant" aria-busy="true">
            {live.text ? <Markdown text={live.text} /> : <p className="fx-muted">{live.status || 'Gizmo is thinking…'}</p>}
            {showTools && <ToolCards tools={live.tools.map(toolCard)} open={openTools} toggle={toggleTool} />}
            {live.error && <p className="axp-companion__note axp-companion__note--danger">{live.error}</p>}
          </article>
        )}
        {err && <p className="axp-companion__note axp-companion__note--danger">{err}</p>}
        <div ref={endRef} />
      </main>

      <footer className="axp-companion__composer">
        {talk.on && (
          <div className="axp-companion__talk">
            <Icon name="mic" size={14} />
            <span className="axp-companion__clip">{talk.phase === 'listening' ? (talk.heard || 'Listening… talk to Gizmo') : talk.phase === 'thinking' ? `“${talk.heard}”` : talk.phase === 'speaking' ? 'Gizmo is talking (say “stop” to cut in)' : ''}</span>
            {talk.phase === 'speaking' && <Button size="sm" icon="x" onClick={stopSpeaking}>Quiet</Button>}
          </div>
        )}
        {budget.level === 'warn' && <p className="axp-companion__note">Today: {money(spentUsd)} of your {money(capUsd)} cap ({budget.left} left).</p>}
        {editing && <p className="axp-companion__note">Editing a message: send to replace it and everything after. <Button size="sm" icon="x" onClick={() => { setEditing(''); setText(''); }}>Cancel</Button></p>}
        {(images.length > 0 || files.length > 0) && (
          <div className="axp-companion__attached">
            {images.map((im, i) => <span key={`i${i}`} className="fx-chip">{im.name ?? 'image'} <IconButton icon="x" label="Remove" onClick={() => setImages((x) => x.filter((_, j) => j !== i))} /></span>)}
            {files.map((f, i) => <span key={`f${i}`} className="fx-chip">{f.name} <IconButton icon="x" label="Remove" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} /></span>)}
          </div>
        )}
        <textarea ref={inputRef} className="fx-input axp-companion__input" rows={2} value={text} placeholder={`Message ${COMPANION.name}`} aria-label={`Message ${COMPANION.name}`}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={(e) => { const fl = Array.from(e.clipboardData.files); if (fl.length) { e.preventDefault(); void addFiles(fl); } }} />
        <div className="axp-companion__inputrow">
          <IconButton icon="upload" label="Attach a file or image" onClick={() => fileRef.current?.click()} />
          <IconButton icon="smartphone" label="Take a photo" onClick={() => photoRef.current?.click()} />
          <input ref={fileRef} type="file" multiple hidden accept="image/*,text/*,.md,.json,.ts,.tsx,.js,.mjs,.py,.kt,.css,.html,.yml,.yaml,.log,.csv" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={photoRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
          <Button size="sm" icon={(live?.mode ?? lastAssistant?.meta?.mode)?.mode === 'tools' ? 'zap' : 'sparkles'} className="axp-companion__mode" title={`Tools: ${MODE_NAME[toolMode]}${turnMode ? `. This turn: ${turnMode}` : ''}. Tap to change.`} onClick={() => void cycleMode()}>
            <span className="axp-companion__clip">{toolMode === 'auto' && turnMode ? `Auto · ${turnMode}` : MODE_NAME[toolMode]}</span>
          </Button>
          <span className="axp-companion__grow" />
          <IconButton icon="mic" label="Push to talk" onClick={ptt} disabled={!!live} />
          <IconButton icon={talk.on ? 'pause' : 'play'} label={talk.on ? 'Leave talk mode' : 'Talk mode (hands-free)'} onClick={toggleTalk} />
          {live ? <Button tone="danger" size="sm" icon="x-circle" onClick={stop}>Stop</Button> : <Button tone="primary" size="sm" icon="arrow-right" onClick={() => send()} disabled={!text.trim() && !images.length && !files.length}>Send</Button>}
        </div>
      </footer>
    </div>
  );
}
