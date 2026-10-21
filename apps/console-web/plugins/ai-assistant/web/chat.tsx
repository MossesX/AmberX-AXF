/*
 * The assistant chat (Fable rebuild): conversations sidebar with search, tags, pin and archive; streamed replies that
 * live on the host (assistant@1 `watchReply` reattaches and replays); composer with attachments, slash prompts and
 * console context; per-message actions; the in-chat settings dialog; model comparison; write-mode badge and approval
 * cards. Used full-page (view "ai-assistant") and inside the chat dialog ("ai-assistant.chat").
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Button, Chip, Icon, Markdown, useAxfState, useRuntime } from '@console/axf/react';
import { ChangeBatchCard, readEventStream, type Batch } from '@console/changeBatch';
import { pluginFetch } from '@console/plugins';
import { ActivityIcon, useReportActivity } from './activity';
import { ChatSettingsDialog } from './settings';
import {
  FOLDER, call, client, emptyLiveReply, fileToImage, fmtNum, fmtTime, normalizeChatContext, post, statusStore, watchReply,
  type ConvSettings, type ConvSummary, type Conversation, type Ctx, type Image, type LiveReply, type Message, type Status, type WriteMode,
} from './api';

interface TextFile { name: string; text: string }

const LAST = 'axf-ai-assistant:last';
const remember = (id: string) => { try { localStorage.setItem(LAST, id); } catch { /* storage blocked */ } };
const recall = () => { try { return localStorage.getItem(LAST) ?? ''; } catch { return ''; } };

export function useStatus(): Status | undefined {
  useEffect(() => { if (!statusStore.get()) void statusStore.reload(); }, []);
  return useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get);
}

/** `start`: open a fresh conversation with this agent and send this message at once (e.g. “Build with Mosses”). */
export interface ChatStart { agentId?: string; message: string; title?: string; profileId?: string | null; model?: string | null }

const snapshot = (r: LiveReply): LiveReply => ({ ...r, tools: r.tools.map((t) => ({ ...t })) });

export function ChatPanel({ compact = false, initialContext, onClose, start, openId }: { compact?: boolean; initialContext?: Ctx; onClose?: () => void; start?: ChatStart; openId?: string }) {
  const rt = useRuntime();
  const axState = useAxfState();
  const status = useStatus();
  const [list, setList] = useState<ConvSummary[]>([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const [showList, setShowList] = useState(!compact);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [pending, setPending] = useState<ConvSettings>({});
  const [text, setText] = useState('');
  const [images, setImages] = useState<Image[]>([]);
  const [files, setFiles] = useState<TextFile[]>([]);
  const [ctx, setCtx] = useState<Ctx | undefined>(initialContext);
  const [live, setLive] = useState<LiveReply | null>(null);
  const [editing, setEditing] = useState<string>('');
  const [sheet, setSheet] = useState<'' | 'settings' | 'compare'>('');
  const [renaming, setRenaming] = useState('');
  const [tagging, setTagging] = useState('');
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const name = status?.assistantName || 'Assistant';
  const activity = useReportActivity(live);

  const loadList = () => Promise.all([
    client.listConversations(q, archived).then((items) => setList(tag ? items.filter((c) => c.tags.includes(tag)) : items), (e: Error) => setErr(e.message)),
    call<{ items: string[] }>('tags').then((r) => setTags(r.items), () => undefined),
  ]);
  const convId = useRef('');
  const open = async (id: string, follow = true) => {
    if (follow && convId.current !== id) abort.current?.abort(); // switching chats detaches from the old one (it keeps running)
    convId.current = id;
    try {
      const c = await client.getConversation(id);
      setConv(c); remember(id); setErr(''); if (compact) setShowList(false);
      if (follow) void attach(c);
    } catch { setConv(null); remember(''); }
  };
  useEffect(() => { void loadList(); }, [archived, tag]);
  const started = useRef(false);
  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const settings: ConvSettings = { ...(start.agentId ? { agentId: start.agentId } : {}), ...(start.profileId ? { profileId: start.profileId } : {}), ...(start.profileId && start.model ? { model: start.model } : {}) };
        const c = await client.createConversation(settings, start.title);
        setConv(c); remember(c.id); convId.current = c.id; if (compact) setShowList(false);
        const opt: Message = { id: `tmp-${Date.now()}`, role: 'user', content: start.message, createdAt: Date.now(), meta: { context: null } };
        await run({ content: start.message }, opt, c);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => void loadList(), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const last = openId || recall(); if (last) void open(last); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [conv?.messages.length, live?.text, live?.tools.length]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 60); }, [conv?.id]);

  const settings: ConvSettings = conv?.settings ?? pending;
  const agents = status?.integrations.agents ? status.agents : [];
  const activeAgent = agents.find((a) => a.id === (settings.agentId ?? (conv ? '' : status?.defaultAgent)));
  const [writeMode, setWriteMode] = useState<WriteMode | null>(null);
  useEffect(() => {
    setWriteMode(null);
    if (!activeAgent) return;
    let on = true;
    void call<{ writeMode: WriteMode | null }>(`agents/${encodeURIComponent(activeAgent.id)}/write-mode`).then((r) => { if (on) setWriteMode(r.writeMode); }, () => undefined);
    return () => { on = false; };
  }, [activeAgent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const newChat = () => { abort.current?.abort(); convId.current = ''; setConv(null); setPending({}); remember(''); setEditing(''); setText(''); setTimeout(() => inputRef.current?.focus(), 30); };
  const updateSettings = async (s: Partial<ConvSettings>) => {
    if (!conv) { setPending((p) => ({ ...p, ...s })); return; }
    setConv(await client.patchConversation(conv.id, { settings: s }));
  };

  const ensureConv = async (): Promise<Conversation> => {
    if (conv) return conv;
    const s = { ...pending };
    if (s.agentId === undefined && status?.defaultAgent && agents.some((a) => a.id === status.defaultAgent)) s.agentId = status.defaultAgent;
    const c = await client.createConversation(s);
    setConv(c); remember(c.id); convId.current = c.id;
    return c;
  };

  /*
   * Live sessions (live-session@1): a reply runs on its host, not in this tab. This view only watches the
   * conversation's event log through the framework's watchReply: it reattaches and replays after drops, closing
   * the chat just detaches, and opening the conversation again (on any device) picks the running reply back up.
   */
  const finish = async (cid: string, reply: LiveReply) => {
    abort.current = null;
    if (convId.current === cid) await open(cid, false);
    void loadList();
    void statusStore.reload();
    if (reply.error) setErr(reply.error);
    setLive(null);
  };

  const run = async (body: Record<string, unknown>, optimistic?: Message, c0?: Conversation) => {
    if (live) return;
    setErr('');
    let c: Conversation;
    try { c = c0 ?? await ensureConv(); } catch (e) { setErr((e as Error).message); return; }
    if (optimistic) {
      const msgs = body.editMessageId ? c.messages.slice(0, c.messages.findIndex((m) => m.id === body.editMessageId)) : c.messages;
      setConv({ ...c, messages: [...msgs, optimistic] });
    } else if (body.regenerate) {
      const msgs = [...c.messages];
      while (msgs.length && msgs[msgs.length - 1]?.role !== 'user') msgs.pop();
      setConv({ ...c, messages: msgs });
    }
    const reply = emptyLiveReply('Connecting…', activeAgent?.name ?? '');
    setLive(snapshot(reply));
    const ac = new AbortController();
    abort.current = ac;
    try {
      await watchReply(client, c.id, reply, (r) => setLive(snapshot(r)), (on, sig) => client.send(c.id, body, on, sig), ac.signal);
    } catch (e) {
      reply.error = (e as Error).message;
    } finally {
      await finish(c.id, reply);
    }
  };

  /** Opening a conversation whose reply is still running (started here, in another tab or on another device): follow it. */
  const attach = async (c: Conversation) => {
    const info = await client.session(c.id);
    if (!info || info.state !== 'running' || abort.current) return;
    const reply = emptyLiveReply('Following the running reply…', activeAgent?.name ?? '');
    reply.lastSeq = Math.max(0, Number(info.meta?.turnSeq ?? info.lastSeq) - 1);
    setLive(snapshot(reply));
    const ac = new AbortController();
    abort.current = ac;
    try { await watchReply(client, c.id, reply, (r) => setLive(snapshot(r)), null, ac.signal); } finally { await finish(c.id, reply); }
  };
  useEffect(() => () => abort.current?.abort(), []); // leaving the chat only detaches

  const stop = () => { if (conv) void client.stop(conv.id); };

  const slash = (t: string): boolean => {
    const [cmd, ...rest] = t.trim().split(/\s+/);
    const arg = rest.join(' ');
    if (cmd === '/new' || cmd === '/clear') { newChat(); return true; }
    if (cmd === '/settings') { setSheet('settings'); return true; }
    if (cmd === '/compare') { setSheet('compare'); return true; }
    if (cmd === '/export' && conv) { void exportConv(arg === 'json' ? 'json' : arg === 'txt' ? 'txt' : 'md'); return true; }
    if (cmd === '/stop') { stop(); return true; }
    if (cmd === '/tag' && conv) { void client.patchConversation(conv.id, { tags: [...new Set([...conv.tags, ...arg.split(/[\s,]+/).filter(Boolean)])] }).then((c) => { setConv(c); void loadList(); }); return true; }
    if (cmd === '/agent') {
      const a = agents.find((x) => x.name.toLowerCase().startsWith(arg.toLowerCase()) || x.id === arg);
      void updateSettings({ agentId: arg && a ? a.id : '' });
      rt.toast(a ? `Now chatting with ${a.name}` : `Agent cleared — chatting with ${name}`, 'info');
      return true;
    }
    if (cmd === '/model') { void updateSettings({ model: arg }); rt.toast(arg ? `Model set to ${arg}` : 'Model reset to the provider default', 'info'); return true; }
    if (cmd === '/system') { void updateSettings({ systemPrompt: arg }); rt.toast(arg ? 'Conversation instructions set' : 'Conversation instructions cleared', 'info'); return true; }
    return false;
  };

  const send = () => {
    let content = text.trim();
    if (!content && !images.length && !files.length) return;
    if (content.startsWith('/') && !files.length && !images.length && slash(content)) { setText(''); return; }
    if (files.length) content += files.map((f) => `\n\n\`\`\`${f.name}\n${f.text}\n\`\`\``).join('');
    const body: Record<string, unknown> = { content, images, context: normalizeChatContext(ctx) ?? undefined };
    if (editing) body.editMessageId = editing;
    const opt: Message = { id: `tmp-${Date.now()}`, role: 'user', content, images, createdAt: Date.now(), meta: { context: ctx ?? null } };
    setText(''); setImages([]); setFiles([]); setEditing(''); setCtx(undefined);
    void run(body, opt);
  };

  const addFiles = async (fl: FileList | File[]) => {
    for (const f of Array.from(fl).slice(0, 8)) {
      if (f.type.startsWith('image/')) {
        if (f.size > 6_000_000) { rt.toast(`${f.name} is over 6 MB`, 'warning'); continue; }
        const img = await fileToImage(f);
        setImages((x) => [...x, img].slice(0, 6));
      } else if (f.size <= 300_000) {
        const t = await f.text();
        setFiles((x) => [...x, { name: f.name, text: t }]);
      } else rt.toast(`${f.name} is too large to attach as text (300 KB max)`, 'warning');
    }
  };
  const onPaste = (e: ClipboardEvent) => { const fl = Array.from(e.clipboardData.files); if (fl.length) { e.preventDefault(); void addFiles(fl); } };
  const onDrop = (e: DragEvent) => { if (e.dataTransfer.files.length) { e.preventDefault(); void addFiles(e.dataTransfer.files); } };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape' && live) stop();
    else if (e.key === 'Escape' && editing) { setEditing(''); setText(''); }
    else if (e.key === 'ArrowUp' && !text && conv) {
      const last = [...conv.messages].reverse().find((m) => m.role === 'user');
      if (last) { e.preventDefault(); setEditing(last.id); setText(last.content); }
    }
  };

  const exportConv = async (fmt: 'md' | 'json' | 'txt') => {
    if (!conv) return;
    const r = await pluginFetch(FOLDER, `conversations/${conv.id}/export?format=${fmt}`);
    const blob = new Blob([fmt === 'json' ? JSON.stringify(await r.json(), null, 2) : await r.text()], { type: fmt === 'json' ? 'application/json' : fmt === 'txt' ? 'text/plain' : 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${conv.title.replace(/[^\w-]+/g, '-').slice(0, 40) || 'conversation'}.${fmt}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importConv = async (f: File) => {
    try { const r = await post<{ conversation: Conversation }>('conversations/import', JSON.parse(await f.text())); await open(r.conversation.id); void loadList(); rt.toast('Conversation imported', 'success'); }
    catch (e) { rt.toast(`Import failed: ${(e as Error).message}`, 'danger'); }
  };
  const continueReply = () => { setText('continue'); void run({ content: 'continue' }, { id: `tmp-${Date.now()}`, role: 'user', content: 'continue', createdAt: Date.now(), meta: { context: null } }); setText(''); };

  const slashMatches = useMemo(() => {
    if (!text.startsWith('/') || text.includes(' ')) return [];
    const builtins = [
      { shortcut: '/new', title: 'New conversation', text: '' }, { shortcut: '/settings', title: 'Chat settings', text: '' },
      { shortcut: '/compare', title: 'Compare models', text: '' }, { shortcut: '/export', title: 'Export as Markdown (/export json|txt)', text: '' },
      { shortcut: '/system ', title: 'Set instructions for this conversation', text: '' }, { shortcut: '/model ', title: 'Set the model for this conversation', text: '' },
      { shortcut: '/tag ', title: 'Tag this conversation', text: '' }, { shortcut: '/stop', title: 'Stop the running reply', text: '' },
      ...(agents.length ? [{ shortcut: '/agent ', title: 'Switch agent', text: '' }] : []),
    ];
    return [...(status?.prompts ?? []), ...builtins].filter((p) => p.shortcut.startsWith(text)).slice(0, 8);
  }, [text, status?.prompts, agents.length]);

  const visible = (conv?.messages ?? []).filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.meta?.step));
  const lastAssistant = [...visible].reverse().find((m) => m.role === 'assistant');

  if (status?.needsSetup) {
    return (
      <div className="axp-ai-assistant__empty fx-stack">
        <Icon name="sparkles" size={28} />
        <h3>Set up {name}</h3>
        <p className="fx-muted">Connect at least one AI provider — Anthropic, OpenAI, Grok, Gemini, Ollama and a dozen more from the framework's provider registry. The wizard takes a minute.</p>
        <div className="fx-row fx-row--wrap"><Button tone="primary" icon="rocket" onClick={() => { onClose?.(); rt.dispatch('settings.open:ai-assistant'); }}>Open the setup wizard</Button></div>
      </div>
    );
  }

  return (
    <div className={`axp-ai-assistant${compact ? ' is-compact' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {showList && (
        <aside className="axp-ai-assistant__side">
          <div className="axp-ai-assistant__side-head">
            <Button tone="primary" icon="plus" onClick={newChat}>New chat</Button>
            <button type="button" className="fx-iconbtn" aria-label="Hide conversations" onClick={() => setShowList(false)}><Icon name="x" size={14} /></button>
          </div>
          <input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
          <div className="axp-ai-assistant__tabs" role="tablist">
            <button type="button" role="tab" className="axp-ai-assistant__tab" aria-selected={!archived} onClick={() => setArchived(false)}>Chats</button>
            <button type="button" role="tab" className="axp-ai-assistant__tab" aria-selected={archived} onClick={() => setArchived(true)}>Archived</button>
          </div>
          {tags.length > 0 && (
            <div className="axp-ai-assistant__tagrow" role="group" aria-label="Filter by tag">
              {tags.slice(0, 12).map((t) => <button key={t} type="button" className={`fx-chip axp-ai-assistant__tagchip${tag === t ? ' is-active' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? '' : t)}>#{t}</button>)}
            </div>
          )}
          <div className="axp-ai-assistant__convs">
            {list.length === 0 && <p className="fx-muted fx-small">{q || tag ? 'No matches.' : 'No conversations yet.'}</p>}
            {list.map((c) => (
              <div key={c.id} className={`axp-ai-assistant__conv${c.id === conv?.id ? ' is-active' : ''}`}>
                {renaming === c.id ? (
                  <input className="fx-input" autoFocus defaultValue={c.title} aria-label="Conversation title"
                    onBlur={(e) => { void client.patchConversation(c.id, { title: e.target.value }).then(() => { setRenaming(''); void loadList(); if (conv?.id === c.id) void open(c.id, false); }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(''); }} />
                ) : tagging === c.id ? (
                  <input className="fx-input" autoFocus defaultValue={c.tags.join(', ')} placeholder="tags, comma separated" aria-label="Tags"
                    onBlur={(e) => { void client.patchConversation(c.id, { tags: e.target.value.split(/[\s,]+/).filter(Boolean) }).then(() => { setTagging(''); void loadList(); if (conv?.id === c.id) void open(c.id, false); }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setTagging(''); }} />
                ) : (
                  <button type="button" className="axp-ai-assistant__conv-main" onClick={() => void open(c.id)}>
                    <strong>{c.pinned && <Icon name="star" size={11} />} {c.title}</strong>
                    <span className="fx-small fx-muted">{c.messages} msgs · {fmtTime(c.updatedAt)}{c.agentId ? ` · ${agents.find((a) => a.id === c.agentId)?.name ?? c.agentId}` : ''}{c.owner ? ` · ${c.owner}` : ''}</span>
                    {c.tags.length > 0 && <span className="fx-small fx-muted">{c.tags.map((t) => `#${t}`).join(' ')}</span>}
                  </button>
                )}
                <div className="axp-ai-assistant__conv-acts">
                  <button type="button" className="fx-iconbtn" title={c.pinned ? 'Unpin' : 'Pin'} onClick={() => void client.patchConversation(c.id, { pinned: !c.pinned }).then(loadList)}><Icon name="star" size={12} /></button>
                  <button type="button" className="fx-iconbtn" title="Rename" onClick={() => setRenaming(c.id)}><Icon name="edit" size={12} /></button>
                  <button type="button" className="fx-iconbtn" title="Tags" onClick={() => setTagging(c.id)}><Icon name="list" size={12} /></button>
                  <button type="button" className="fx-iconbtn" title={c.archived ? 'Unarchive' : 'Archive'} onClick={() => void client.patchConversation(c.id, { archived: !c.archived }).then(loadList)}><Icon name="box" size={12} /></button>
                  <button type="button" className="fx-iconbtn" title="Delete" onClick={() => { if (confirm(`Delete "${c.title}"?`)) void client.deleteConversation(c.id).then(() => { if (conv?.id === c.id) newChat(); void loadList(); }); }}><Icon name="trash" size={12} /></button>
                </div>
              </div>
            ))}
          </div>
          <label className="axp-ai-assistant__import fx-small fx-muted"><Icon name="upload" size={12} /> Import JSON<input type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importConv(f); e.target.value = ''; }} /></label>
        </aside>
      )}

      <section className="axp-ai-assistant__main">
        <header className="axp-ai-assistant__head">
          {!showList && <button type="button" className="fx-iconbtn" title="Conversations" onClick={() => setShowList(true)}><Icon name="list" size={16} /></button>}
          <div className="axp-ai-assistant__title">
            <ActivityIcon icon={activeAgent?.icon || 'sparkles'} size={16} state={activity} />
            <div className="fx-stack axp-ai-assistant__title-text">
              <strong>{conv?.title ?? (activeAgent ? `Chat with ${activeAgent.name}` : `Chat with ${name}`)}</strong>
              <span className="fx-small fx-muted">{activeAgent ? `${activeAgent.name} · ` : ''}{settings.model || status?.defaultProfile?.defaultModel || ''}{settings.profileId ? ` · ${settings.profileId}` : status?.defaultProfile ? ` · ${status.defaultProfile.label}` : ''}</span>
            </div>
          </div>
          {live && <span className="axp-ai-assistant__livepill" title="This reply runs on its host: closing the chat only detaches, and any device can follow it."><Icon name="cloud" size={12} /> live</span>}
          {writeMode && (
            <span className="axp-ai-assistant__write" title={`${activeAgent?.name ?? 'This agent'} can propose changes to these containers. Nothing changes until you approve a card; a snapshot is taken first.`}>
              <Icon name="shield" size={13} /> Write mode{writeMode.containers.length ? `: ${writeMode.containers.slice(0, 4).join(', ')}${writeMode.containers.length > 4 ? ` +${writeMode.containers.length - 4}` : ''}` : ''}
            </span>
          )}
          {agents.length > 0 && (
            <select className="fx-input axp-ai-assistant__agent" value={settings.agentId ?? (conv ? '' : status?.defaultAgent ?? '')} onChange={(e) => void updateSettings({ agentId: e.target.value })} aria-label="Active agent" title="Active agent (from the agent manager)">
              <option value="">{name} (no agent)</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button type="button" className="fx-iconbtn" title="Chat settings" onClick={() => setSheet('settings')}><Icon name="sliders" size={16} /></button>
          <button type="button" className="fx-iconbtn" title="Compare models" onClick={() => setSheet('compare')}><Icon name="layers" size={16} /></button>
          {conv && <button type="button" className="fx-iconbtn" title="Export Markdown" onClick={() => void exportConv('md')}><Icon name="download" size={16} /></button>}
          {conv && <button type="button" className="fx-iconbtn" title="Export JSON" onClick={() => void exportConv('json')}><Icon name="code" size={16} /></button>}
          <button type="button" className="fx-iconbtn" title="New chat" onClick={newChat}><Icon name="plus" size={16} /></button>
        </header>

        <div className="axp-ai-assistant__body">
          {visible.length === 0 && !live && (
            <div className="axp-ai-assistant__welcome fx-stack">
              <Icon name={activeAgent?.icon || 'sparkles'} size={28} />
              <h3>{activeAgent ? `Ask ${activeAgent.name}` : `Ask ${name} anything`}</h3>
              <p className="fx-muted fx-small">{activeAgent?.description || 'About this framework and its code (it reads the real repository), or anything else. Type / for prompts and commands; paste or drop images and files. Replies keep running if you leave.'}</p>
              <div className="axp-ai-assistant__suggest">{(status?.suggestions ?? []).map((s) => <button key={s} type="button" className="fx-chip" onClick={() => { setText(s); inputRef.current?.focus(); }}>{s}</button>)}</div>
            </div>
          )}
          {visible.map((m) => (
            <MessageView key={m.id} m={m} name={name} isLast={m.id === lastAssistant?.id} busy={!!live} showUsage={status?.showUsage !== false}
              onCopy={() => void navigator.clipboard?.writeText(m.content).then(() => rt.toast('Copied', 'success'))}
              onEdit={() => { setEditing(m.id); setText(m.content); inputRef.current?.focus(); }}
              onRegenerate={() => void run({ regenerate: true })}
              onContinue={continueReply}
              onFork={() => void client.fork(conv!.id, m.id).then((c) => { void open(c.id); void loadList(); rt.toast('Forked into a new conversation', 'success'); })}
              onDelete={() => void client.deleteMessage(conv!.id, m.id).then(setConv)} />
          ))}
          {live && (
            <div className="axp-ai-assistant__msg is-ai">
              <div className="axp-ai-assistant__avatar"><Icon name={activeAgent?.icon || 'sparkles'} size={14} /></div>
              <div className="axp-ai-assistant__bubble">
                {live.agent && <span className="fx-small fx-muted">{live.agent}</span>}
                {live.tools.length > 0 && <div className="axp-ai-assistant__tools">{live.tools.map((t) => <ToolChip key={t.id} name={t.name} input={t.input} ok={t.ok} preview={t.preview} running={!t.done} />)}</div>}
                {live.thinking && <details className="axp-ai-assistant__thinking"><summary>Thinking…</summary><p>{live.thinking}</p></details>}
                {live.text ? <Markdown text={live.text} /> : <p className="fx-muted fx-small axp-ai-assistant__pulse">{live.status}</p>}
                {live.text && <span className="fx-small fx-muted axp-ai-assistant__pulse">{live.status.startsWith('Thinking') ? '' : live.status}</span>}
              </div>
            </div>
          )}
          {err && <div className="axp-ai-assistant__note is-warn"><Icon name="alert" size={14} />{err}</div>}
          <div ref={endRef} />
        </div>

        <div className="axp-ai-assistant__compose">
          {slashMatches.length > 0 && (
            <div className="axp-ai-assistant__slash" role="listbox">
              {slashMatches.map((p) => (
                <button key={p.shortcut} type="button" role="option" aria-selected="false" className="axp-ai-assistant__slash-item"
                  onClick={() => { if (p.text) setText(p.text); else if (p.shortcut.endsWith(' ')) setText(p.shortcut); else { slash(p.shortcut); setText(''); } inputRef.current?.focus(); }}>
                  <span className="fx-mono">{p.shortcut.trim()}</span><span className="fx-small fx-muted">{p.title}</span>
                </button>
              ))}
            </div>
          )}
          {(editing || ctx || images.length > 0 || files.length > 0) && (
            <div className="axp-ai-assistant__chips">
              {editing && <span className="fx-chip">Editing a message <button type="button" className="axp-ai-assistant__x" aria-label="Cancel edit" onClick={() => { setEditing(''); setText(''); }}><Icon name="x" size={10} /></button></span>}
              {ctx && <span className="fx-chip"><Icon name="monitor" size={10} /> {ctx.view ? `View: ${ctx.view}` : 'Context'}{ctx.selection ? ` · “${ctx.selection.slice(0, 40)}”` : ''} <button type="button" className="axp-ai-assistant__x" aria-label="Remove context" onClick={() => setCtx(undefined)}><Icon name="x" size={10} /></button></span>}
              {images.map((im, i) => <span key={i} className="fx-chip"><Icon name="eye" size={10} /> {im.name || 'image'} <button type="button" className="axp-ai-assistant__x" aria-label="Remove image" onClick={() => setImages((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={10} /></button></span>)}
              {files.map((f, i) => <span key={i} className="fx-chip"><Icon name="file" size={10} /> {f.name} <button type="button" className="axp-ai-assistant__x" aria-label="Remove file" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={10} /></button></span>)}
            </div>
          )}
          <div className="axp-ai-assistant__inputrow">
            <button type="button" className="fx-iconbtn" title="Attach images or text files" onClick={() => fileRef.current?.click()}><Icon name="plus" size={16} /></button>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="fx-iconbtn" title="Attach the current console view as context" onClick={() => setCtx({ view: axState.view, title: document.title, selection: String(globalThis.getSelection?.() ?? '').slice(0, 4000) || undefined })}><Icon name="monitor" size={16} /></button>
            <textarea ref={inputRef} className="fx-input axp-ai-assistant__textarea" rows={compact ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
              placeholder={`Message ${activeAgent?.name ?? name}…  (Enter sends · Shift+Enter new line · / for prompts · ↑ edits last)`} aria-label="Message" />
            {live ? <Button icon="pause" onClick={stop}>Stop</Button> : <Button tone="primary" icon="play" disabled={!text.trim() && !images.length && !files.length} onClick={send}>Send</Button>}
          </div>
          {status && status.budget > 0 && <span className="fx-small fx-muted">Today: {fmtNum(status.tokensToday)} / {fmtNum(status.budget)} tokens</span>}
        </div>
      </section>

      {sheet === 'settings' && <ChatSettingsDialog settings={settings} onChange={updateSettings} onClose={() => setSheet('')} onOpenFull={() => { setSheet(''); onClose?.(); rt.dispatch('settings.open:ai-assistant'); }} />}
      {sheet === 'compare' && <CompareDialog initial={text} onClose={() => setSheet('')} />}
    </div>
  );
}

function ToolChip({ name, input, ok, preview, running }: { name: string; input?: string; ok?: boolean; preview?: string; running?: boolean }) {
  return (
    <details className={`axp-ai-assistant__tool${ok === false ? ' is-bad' : ''}`}>
      <summary><Icon name={running ? 'clock' : ok === false ? 'alert' : 'zap'} size={11} /> <span className="fx-mono">{name}</span>{input ? <span className="fx-muted"> {input}</span> : null}</summary>
      {preview && <pre className="axp-ai-assistant__tool-out">{preview}</pre>}
    </details>
  );
}

function MessageView({ m, name, isLast, busy, showUsage, onCopy, onEdit, onRegenerate, onContinue, onFork, onDelete }: {
  m: Message; name: string; isLast: boolean; busy: boolean; showUsage: boolean;
  onCopy: () => void; onEdit: () => void; onRegenerate: () => void; onContinue: () => void; onFork: () => void; onDelete: () => void;
}) {
  const ai = m.role === 'assistant';
  const meta = m.meta ?? {};
  const tools = meta.tools ?? [];
  return (
    <div className={`axp-ai-assistant__msg ${ai ? 'is-ai' : 'is-user'}${meta.interrupted ? ' is-interrupted' : ''}`}>
      <div className="axp-ai-assistant__avatar"><Icon name={ai ? 'sparkles' : 'user'} size={14} /></div>
      <div className="axp-ai-assistant__bubble">
        {ai && meta.agentName && <span className="fx-small fx-muted">{meta.agentName}</span>}
        {ai && meta.interrupted && <Chip tone="warning">interrupted</Chip>}
        {tools.length > 0 && <div className="axp-ai-assistant__tools">{tools.map((t) => <ToolChip key={t.id} name={t.name} input={t.input} ok={t.ok} preview={t.preview} />)}</div>}
        {ai && meta.thinking && <details className="axp-ai-assistant__thinking"><summary>Reasoning</summary><p>{meta.thinking}</p></details>}
        {m.images?.length ? <div className="axp-ai-assistant__imgs">{m.images.map((im, i) => <img key={i} alt={im.name || 'attachment'} src={`data:${im.media_type};base64,${im.data}`} />)}</div> : null}
        {ai ? <Markdown text={m.content || (meta.stopped ? '(stopped)' : '')} /> : <p className="axp-ai-assistant__plain">{m.content}</p>}
        {ai && meta.batch && <BatchFromId id={meta.batch} />}
        {!ai && meta.context?.view && <span className="fx-small fx-muted">context: {meta.context.view}{meta.context.selection ? ` · “${meta.context.selection.slice(0, 80)}”` : ''}</span>}
        <div className="axp-ai-assistant__meta">
          {ai && showUsage && (meta.model || meta.usage) && <span className="fx-small fx-muted">{meta.model}{meta.latencyMs ? ` · ${(meta.latencyMs / 1000).toFixed(1)}s` : ''}{meta.usage ? ` · ${fmtNum(meta.usage.input)}→${fmtNum(meta.usage.output)} tok` : ''}</span>}
          <span className="axp-ai-assistant__acts">
            <button type="button" className="fx-iconbtn" title="Copy" onClick={onCopy}><Icon name="copy" size={12} /></button>
            {!ai && <button type="button" className="fx-iconbtn" title="Edit and resend" disabled={busy} onClick={onEdit}><Icon name="edit" size={12} /></button>}
            {ai && isLast && <button type="button" className="fx-iconbtn" title="Regenerate" disabled={busy} onClick={onRegenerate}><Icon name="refresh" size={12} /></button>}
            {ai && isLast && (meta.interrupted || meta.stopped) && <button type="button" className="fx-iconbtn" title="Continue this reply" disabled={busy} onClick={onContinue}><Icon name="play" size={12} /></button>}
            <button type="button" className="fx-iconbtn" title="Fork from here" disabled={busy} onClick={onFork}><Icon name="branch" size={12} /></button>
            <button type="button" className="fx-iconbtn" title="Delete" disabled={busy} onClick={onDelete}><Icon name="trash" size={12} /></button>
          </span>
        </div>
      </div>
      <span className="axp-ai-assistant__sr">{ai ? name : 'You'}</span>
    </div>
  );
}

/** The approval card for the change batch an agent proposed in this reply (change-batch@1, via axf.containers@1). */
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

interface CompareResult { profileId: string; label?: string; model: string; ok: boolean; text?: string; error?: string; ms: number; usage?: { input: number; output: number } }

function CompareDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [profiles, setProfiles] = useState<{ id: string; label: string; defaultModel: string }[]>([]);
  const [targets, setTargets] = useState<{ profileId: string; model: string }[]>([]);
  const [prompt, setPrompt] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CompareResult[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    void call<{ profiles: { id: string; label: string; defaultModel: string; enabled: boolean; keyReady: boolean }[] }>('config').then((c) => {
      const ready = c.profiles.filter((p) => p.enabled && p.keyReady);
      setProfiles(ready);
      setTargets(ready.slice(0, 2).map((p) => ({ profileId: p.id, model: p.defaultModel })));
    });
  }, []);
  const go = async () => {
    setBusy(true); setErr(''); setRes([]);
    try { setRes((await post<{ results: CompareResult[] }>('compare', { prompt, targets })).results); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="axp-ai-assistant__sheet" role="dialog" aria-modal="true" aria-label="Compare models">
      <div className="axp-ai-assistant__sheet-panel fx-stack">
        <header className="axp-ai-assistant__sheet-head"><Icon name="layers" size={16} /><h3>Compare models</h3><button type="button" className="fx-iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" size={14} /></button></header>
        <textarea className="fx-input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="One prompt, answered by each model side by side" aria-label="Prompt" />
        {targets.map((t, i) => (
          <div key={i} className="fx-row fx-row--wrap">
            <select className="fx-input" value={t.profileId} aria-label="Provider" onChange={(e) => setTargets((x) => x.map((y, j) => (j === i ? { profileId: e.target.value, model: profiles.find((p) => p.id === e.target.value)?.defaultModel ?? '' } : y)))}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input className="fx-input fx-mono" value={t.model} aria-label="Model" onChange={(e) => setTargets((x) => x.map((y, j) => (j === i ? { ...y, model: e.target.value } : y)))} />
            {targets.length > 2 && <button type="button" className="fx-iconbtn" aria-label="Remove" onClick={() => setTargets((x) => x.filter((_, j) => j !== i))}><Icon name="minus" size={12} /></button>}
          </div>
        ))}
        <div className="fx-row fx-row--wrap">
          {targets.length < 4 && profiles[0] && <Button icon="plus" onClick={() => setTargets((x) => [...x, { profileId: profiles[0]?.id ?? '', model: profiles[0]?.defaultModel ?? '' }])}>Add model</Button>}
          <Button tone="primary" icon="play" disabled={busy || !prompt.trim() || targets.length < 2} onClick={() => void go()}>{busy ? 'Asking…' : 'Compare'}</Button>
        </div>
        {profiles.length < 1 && <p className="fx-muted fx-small">Set up at least one provider (two different models work too).</p>}
        {err && <div className="axp-ai-assistant__note is-warn"><Icon name="alert" size={14} />{err}</div>}
        {res.length > 0 && (
          <div className="axp-ai-assistant__compare">
            {res.map((r, i) => (
              <div key={i} className="axp-ai-assistant__card fx-stack">
                <div className="fx-row fx-row--wrap"><strong className="fx-grow">{r.label ?? r.profileId}</strong><Chip tone={r.ok ? 'success' : 'danger'}>{(r.ms / 1000).toFixed(1)}s</Chip></div>
                <span className="fx-small fx-muted fx-mono">{r.model}{r.usage ? ` · ${r.usage.input}→${r.usage.output} tok` : ''}</span>
                {r.ok ? <Markdown text={r.text ?? ''} /> : <p className="axp-ai-assistant__bad">{r.error}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
