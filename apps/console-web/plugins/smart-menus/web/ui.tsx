/**
 * Menus plugin — settings panels and page. Every control is a framework control; the look editor writes the
 * `axf.menus.look` appearance setting (colours are theme-token names, sizes multipliers of theme tokens), so the live
 * preview and every menu in every app restyle at once.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Container, MenuList, Note, Segmented, SelectField, Slider, Switch, TextField, useAxfState, useRuntime } from '@console/axf/react';
import {
  composeMenu, MENU_ANIMATIONS, MENU_EASINGS, MENU_FONTS, MENU_HOVERS, MENU_LOOK_COLORS, MENU_LOOK_DEFAULT, MENU_LOOK_PRESETS, MENU_TOPIC_KINDS,
  normalizeMenuLook, type MenuItem, type MenuLook, type MenuOpen, type MenuSectionKind, type MenuSectionSpec,
} from '@console/axf/core';
import {
  clearTopics, DEFAULT_SETTINGS, exportLook, importLook, lookOf, menusState, resetLearning, saveSettings, setLook, setPin, setTopics, subscribe, TOPIC_TEMPLATES,
} from './core';

export function useMenus() { return useSyncExternalStore(subscribe, menusState, menusState); }
function useTick() { const [, set] = useState(0); useEffect(() => subscribe(() => set((n) => n + 1)), []); }

const SECTION_LABEL: Record<MenuSectionKind, string> = { talking: 'Talking about', pinned: 'Pinned', suggested: 'Suggested', context: 'For this target', static: 'The menu\'s own items' };

/* ------------------------------------------------------------------ sections editor (global or one menu) */

export function SectionsEditor({ value, onChange }: { value: MenuSectionSpec[]; onChange: (v: MenuSectionSpec[]) => void }) {
  const move = (i: number, d: number) => { const n = [...value]; const [x] = n.splice(i, 1); n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x!); onChange(n); };
  const patch = (i: number, p: Partial<MenuSectionSpec>) => onChange(value.map((s, k) => (k === i ? { ...s, ...p } : s)));
  return (
    <div className="axp-smart-menus__sections" data-help="smart-menus-sections">
      {value.map((s, i) => (
        <div key={s.kind} className="axp-smart-menus__section-row">
          <Switch label={SECTION_LABEL[s.kind]} checked={s.on !== false} disabled={s.kind === 'static'} onChange={(on) => patch(i, { on })} hint={s.kind === 'static' ? 'Always on, never reordered' : undefined} />
          {s.kind !== 'static' && (
            <>
              <TextField label="Label" value={s.label ?? ''} onChange={(label) => patch(i, { label })} />
              <SelectField label="Most items" value={String(s.max ?? 4)} options={[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => patch(i, { max: Number(v) })} />
              <Switch label="Folded" checked={!!s.collapsed} onChange={(collapsed) => patch(i, { collapsed })} />
            </>
          )}
          <div className="axp-smart-menus__row-acts">
            <Button size="sm" icon="chevron-up" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${SECTION_LABEL[s.kind]} up`}>Up</Button>
            <Button size="sm" icon="chevron-down" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${SECTION_LABEL[s.kind]} down`}>Down</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SectionsPanel() {
  const m = useMenus();
  return (
    <div className="fx-stack">
      <Switch label="Smart menus" checked={m.settings.enabled} onChange={(enabled) => void saveSettings({ enabled })} hint="Off: every menu is its plain static menu" />
      <Note icon="info">The menu's own items never move. Dynamic sections sit above them, in this order. A menu asset can declare its own sections; a per-menu override (below, or Menu settings in any menu) wins over both.</Note>
      <SectionsEditor value={m.settings.sections} onChange={(sections) => void saveSettings({ sections })} />
      <Button icon="refresh" onClick={() => void saveSettings({ sections: DEFAULT_SETTINGS.sections })}>Default sections</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ behaviour + learning */

export function BehaviourPanel() {
  const m = useMenus();
  const s = m.settings;
  return (
    <div className="fx-stack">
      <Switch label="Learn from what I pick" checked={s.learning} onChange={(learning) => void saveSettings({ learning })} hint="Plain counting on this console's server, no AI calls. Off: nothing is recorded and nothing is suggested." />
      <Slider label="Suggestions" value={s.suggestions} min={0} max={8} onChange={(suggestions) => void saveSettings({ suggestions })} />
      <Switch label="Show why it is suggested" checked={s.showWhy} onChange={(showWhy) => void saveSettings({ showWhy })} />
      <Slider label="Talking about lasts" value={s.topicTtlMin} min={5} max={240} step={5} unit=" min" onChange={(topicTtlMin) => void saveSettings({ topicTtlMin })} />
      <Switch label="Open menu bar menus on hover" checked={s.behavior.openOnHover} onChange={(openOnHover) => void saveSettings({ behavior: { ...s.behavior, openOnHover } })} hint="Desktop" />
      <Slider label="Long-press time (phone)" value={s.behavior.longPressMs} min={0} max={1500} step={50} unit=" ms" onChange={(longPressMs) => void saveSettings({ behavior: { ...s.behavior, longPressMs } })} />
      <Note icon="info">0 ms = the behaviour theme's long-press time.</Note>
      <Switch label="Keyboard: 1-9 run the top items, Esc closes" checked={s.behavior.keyboard} onChange={(keyboard) => void saveSettings({ behavior: { ...s.behavior, keyboard } })} />
    </div>
  );
}

export function LearningPanel() {
  const m = useMenus();
  const rt = useRuntime();
  const menus = useMemo(() => [...new Set([...m.picks.map((p) => p.key.split('|')[0]!), ...Object.keys(m.seen)])].sort(), [m.picks, m.seen]);
  const count = (menu: string) => m.picks.filter((p) => p.key.split('|')[0] === menu).length;
  const forget = async (menu?: string) => { const n = await resetLearning(menu ? { menu } : {}); rt.toast(`Forgot ${n} pick${n === 1 ? '' : 's'}${menu ? ` on ${menu}` : ''}.`, 'success', 'Menus'); };
  return (
    <div className="fx-stack">
      <Note icon="lock">Your picks stay on this console's server (the VPS that runs axHub), under your name. Nothing is sent anywhere else.</Note>
      <p className="fx-muted">{m.picks.length} picks remembered across {menus.length} menus.</p>
      {menus.map((menu) => (
        <div key={menu} className="axp-smart-menus__row">
          <span className="axp-smart-menus__grow">{menu}</span>
          <Chip>{count(menu)}</Chip>
          <Button size="sm" icon="trash" confirm={`Forget what ${menu} learned?`} disabled={!count(menu)} onClick={() => void forget(menu)}>Reset</Button>
        </div>
      ))}
      <Button tone="danger" icon="trash" confirm="Forget everything the menus learned?" disabled={!m.picks.length} onClick={() => void forget()}>Reset all learning</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ per-menu overrides + pins */

export function PerMenuPanel({ initial }: { initial?: string }) {
  const m = useMenus();
  const known = useMemo(() => [...new Set([...Object.keys(m.seen), ...Object.keys(m.settings.perMenu), ...Object.keys(m.pins)])].sort(), [m.seen, m.settings.perMenu, m.pins]);
  const [menu, setMenu] = useState(initial ?? known[0] ?? '');
  useEffect(() => { if (initial) setMenu(initial); }, [initial]);
  const own = m.settings.perMenu[menu];
  const items = m.seen[menu]?.items ?? [];
  const pins = m.pins[menu] ?? [];
  const setOwn = (o: { sections?: MenuSectionSpec[]; off?: boolean } | null) => void saveSettings({ perMenu: { ...m.settings.perMenu, [menu]: o as never } });
  if (!known.length) return <Note icon="info">Open a few menus first: each one you open shows up here, with its items to pin and its own sections.</Note>;
  return (
    <div className="fx-stack">
      <SelectField label="Menu" value={menu} options={known.map((k) => ({ value: k, label: k }))} onChange={setMenu} />
      <Switch label="Plain static menu here" checked={!!own?.off} onChange={(off) => setOwn({ ...own, off })} hint="No dynamic sections in this one menu" />
      <Switch label="Own sections for this menu" checked={!!own?.sections} onChange={(on) => setOwn(on ? { ...own, sections: m.settings.sections } : { off: own?.off })} />
      {own?.sections && <SectionsEditor value={own.sections} onChange={(sections) => setOwn({ ...own, sections })} />}
      <Container title="Pinned items" icon="star">
        {!items.length && <p className="fx-muted">Open this menu once to list its items.</p>}
        {items.map((i) => (
          <Switch key={i.id} label={i.label} checked={pins.includes(i.id)} onChange={(on) => void setPin(menu, i.id, on)} />
        ))}
      </Container>
      <LookOverride menu={menu} />
    </div>
  );
}

/* ------------------------------------------------------------------ look */

const COLOR_ROLES: [keyof NonNullable<MenuLook['colors']>, string][] = [
  ['background', 'Background'], ['text', 'Text'], ['hover', 'Hover / selected'], ['heading', 'Section headers'], ['separator', 'Separators'], ['icon', 'Icons'],
  ['hint', 'Hints'], ['border', 'Border'], ['badge', 'Badges'], ['talking', 'Talking about accent'], ['pinned', 'Pinned accent'], ['suggested', 'Suggested accent'], ['context', 'For this accent'],
];
const colorOptions = MENU_LOOK_COLORS.map((c) => ({ value: c, label: c }));

export function LookEditor({ look, onChange }: { look: MenuLook; onChange: (l: MenuLook) => void }) {
  const n = normalizeMenuLook(look);
  const set = (p: Partial<MenuLook>) => onChange({ ...look, ...p });
  const color = (k: keyof NonNullable<MenuLook['colors']>, v: string) => onChange({ ...look, colors: { ...look.colors, [k]: v } });
  return (
    <div className="fx-stack" data-help="smart-menus-look">
      <Container title="Colours (from the theme)" icon="palette" collapsible>
        <Note icon="info">Each colour is one of the theme's own colours, so switching the theme still restyles every menu.</Note>
        <div className="axp-smart-menus__grid">
          {COLOR_ROLES.map(([k, label]) => <SelectField key={k} label={label} value={n.colors[k]} options={colorOptions} onChange={(v) => color(k, v)} />)}
        </div>
        <Slider label="Opacity" value={Math.round(n.opacity * 100)} min={30} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />
        <Slider label="Glass blur" value={Math.round(n.blur * 100)} min={0} max={300} step={10} unit="%" onChange={(v) => set({ blur: v / 100 })} />
        <Segmented label="Shadow" value={String(n.shadow)} options={['0', '1', '2', '3'].map((v) => ({ value: v, label: ['None', 'Small', 'Medium', 'Large'][Number(v)]! }))} onChange={(v) => set({ shadow: Number(v) })} />
      </Container>
      <Container title="Fonts and sizes" icon="type" collapsible>
        <Segmented label="Font" value={n.font} options={MENU_FONTS.map((f) => ({ value: f, label: f }))} onChange={(font) => set({ font })} />
        <Slider label="Text size" value={Math.round(n.fontScale * 100)} min={70} max={160} step={5} unit="%" onChange={(v) => set({ fontScale: v / 100 })} />
        <SelectField label="Weight" value={String(n.weight)} options={[300, 400, 500, 600, 700, 800].map((w) => ({ value: String(w), label: String(w) }))} onChange={(v) => set({ weight: Number(v) })} />
        <Slider label="Letter spacing" value={Math.round(n.tracking * 1000)} min={-50} max={200} step={5} unit="‰" onChange={(v) => set({ tracking: v / 1000 })} />
        <Slider label="Section header size" value={Math.round(n.headingScale * 100)} min={60} max={120} step={2} unit="%" onChange={(v) => set({ headingScale: v / 100 })} />
        <Segmented label="Section header case" value={n.headingCase} options={[{ value: 'upper', label: 'UPPER' }, { value: 'none', label: 'As written' }]} onChange={(headingCase) => set({ headingCase })} />
        <Slider label="Icon size" value={Math.round(n.iconScale * 100)} min={60} max={180} step={5} unit="%" onChange={(v) => set({ iconScale: v / 100 })} />
        <Slider label="Row height (density)" value={Math.round(n.density * 100)} min={50} max={200} step={5} unit="%" onChange={(v) => set({ density: v / 100 })} />
        <Slider label="Corner radius" value={Math.round(n.radius * 100)} min={0} max={300} step={10} unit="%" onChange={(v) => set({ radius: v / 100 })} />
        <Slider label="Least width" value={n.minWidth} min={10} max={60} unit=" × space" onChange={(minWidth) => set({ minWidth })} />
        <Slider label="Most width" value={n.maxWidth} min={20} max={120} unit=" × space" onChange={(maxWidth) => set({ maxWidth })} />
      </Container>
      <Container title="Animation" icon="zap" collapsible>
        <Segmented label="Open" value={n.animation} options={MENU_ANIMATIONS.map((a) => ({ value: a, label: a }))} onChange={(animation) => set({ animation })} />
        <Slider label="Speed (× theme motion)" value={Math.round(n.speed * 100)} min={0} max={400} step={10} unit="%" onChange={(v) => set({ speed: v / 100 })} />
        <SelectField label="Easing" value={n.easing} options={Object.keys(MENU_EASINGS).map((e) => ({ value: e, label: e }))} onChange={(easing) => set({ easing: easing as MenuLook['easing'] })} />
        <Slider label="Row stagger" value={n.stagger} min={0} max={80} unit=" ms" onChange={(stagger) => set({ stagger })} />
        <Segmented label="Hover" value={n.hover} options={MENU_HOVERS.map((h) => ({ value: h, label: h }))} onChange={(hover) => set({ hover })} />
        <Switch label="Pulse Talking-about items" checked={n.pulseTalking} onChange={(pulseTalking) => set({ pulseTalking })} />
        <Note icon="info">Reduced motion on the device turns every menu animation off.</Note>
      </Container>
    </div>
  );
}

/** A sample menu with every section, drawn by the real renderer with the look being edited. */
export function LookPreview({ menu = 'ctx:preview' }: { menu?: string }) {
  const rt = useRuntime();
  useAxfState();
  useTick();
  const open: MenuOpen = { kind: 'context', menu, target: 'preview', state: ['running'], screen: 'smart-menus', device: 'desktop' };
  const now = Date.now();
  const base: MenuItem[] = [
    { id: 'open', label: 'Open', icon: 'external', action: 'noop' }, { id: 'rename', label: 'Rename', icon: 'edit', action: 'noop' },
    { id: 'copy', label: 'Copy link', icon: 'copy', action: 'noop' }, { id: 'sep', separator: true },
    { id: 'logs', label: 'Show logs', icon: 'terminal', action: 'noop', when: { state: 'running' } },
    { id: 'delete', label: 'Delete', icon: 'trash', action: 'noop' },
  ];
  const items = composeMenu({
    items: base, open, now, pins: ['copy'], sections: menusState().settings.sections,
    picks: [1, 2, 3].map((h) => ({ key: `${menu}|preview|running|smart-menus`, item: 'rename', at: now - h * 60_000 })),
    topics: [{ kind: 'build', id: 'smart-menus', label: 'Smart menus', at: now }], templates: TOPIC_TEMPLATES.filter((t) => t.kind === 'build').map((t) => ({ ...t, items: t.items.slice(0, 1) })),
  }).items;
  return (
    <div className="axp-smart-menus__preview" data-help="smart-menus-preview">
      <div className="fx-ctx fx-popover axp-smart-menus__preview-box" style={rt.menuLookVars(menu)} data-axf-menu={menu}>
        <MenuList items={items} onDone={() => undefined} />
      </div>
    </div>
  );
}

export function LookPanel() {
  const rt = useRuntime();
  useAxfState();
  const look = lookOf(rt);
  const [text, setText] = useState('');
  const doImport = () => { try { setLook(rt, importLook(text)); rt.toast('Menu look imported.', 'success', 'Menus'); setText(''); } catch (e) { rt.toast(String((e as Error).message), 'danger', 'Menus'); } };
  return (
    <div className="axp-smart-menus__look">
      <div className="fx-stack">
        <div className="axp-smart-menus__row">
          <SelectField label="Preset" value="" empty="Pick a preset…" options={Object.entries(MENU_LOOK_PRESETS).map(([id, p]) => ({ value: id, label: p.label }))} onChange={(id) => { const p = MENU_LOOK_PRESETS[id]; if (p) setLook(rt, { ...p.look, perMenu: look.perMenu }); }} />
          <Button icon="refresh" confirm="Put every menu look setting back to the default?" onClick={() => setLook(rt, { perMenu: look.perMenu })}>Reset look</Button>
        </div>
        <LookEditor look={look} onChange={(l) => setLook(rt, { ...l, perMenu: look.perMenu })} />
        <Container title="Export / import" icon="upload" collapsible defaultOpen={false}>
          <Button icon="copy" onClick={() => { void navigator.clipboard?.writeText(exportLook(look)); rt.toast('Menu look copied (menu-look@1).', 'success', 'Menus'); }}>Copy this look</Button>
          <TextField label="Paste a menu look" rows={4} mono value={text} onChange={setText} placeholder='{"$axf": "menu-look@1", "look": {…}}' />
          <Button icon="download" disabled={!text.trim()} onClick={doImport}>Import</Button>
        </Container>
      </div>
      <LookPreview />
    </div>
  );
}

/** One menu's own look (per-menu override), on top of the app-wide look. */
function LookOverride({ menu }: { menu: string }) {
  const rt = useRuntime();
  useAxfState();
  const look = lookOf(rt);
  const own = look.perMenu?.[menu];
  const save = (o: MenuLook | undefined) => { const per = { ...look.perMenu }; if (o) per[menu] = o; else delete per[menu]; setLook(rt, { ...look, perMenu: per }); };
  return (
    <Container title="This menu's own look" icon="palette" collapsible defaultOpen={!!own}>
      <Switch label="Own look for this menu" checked={!!own} onChange={(on) => save(on ? {} : undefined)} />
      {own && (
        <div className="axp-smart-menus__look">
          <LookEditor look={{ ...look, ...own, colors: { ...look.colors, ...own.colors } }} onChange={(l) => { const { perMenu: _p, ...rest } = l; save(rest); }} />
          <LookPreview menu={menu} />
        </div>
      )}
    </Container>
  );
}

/* ------------------------------------------------------------------ topics */

export function TopicsPanel() {
  const m = useMenus();
  const rt = useRuntime();
  const [kind, setKind] = useState<string>('build');
  const [id, setId] = useState('');
  return (
    <div className="fx-stack">
      <Note icon="mic">Amber tells the console what you two are talking about (the console_context tool). Those things go to the top of every menu for {m.settings.topicTtlMin} minutes.</Note>
      {!m.topics.length && <p className="fx-muted">Nothing right now.</p>}
      {m.topics.map((t) => (
        <div key={`${t.kind}:${t.id}`} className="axp-smart-menus__row">
          <Chip tone="accent">{t.kind}</Chip>
          <span className="axp-smart-menus__grow">{t.label || t.id}</span>
          <span className="fx-muted">{Math.max(0, Math.round((Date.now() - t.at) / 60_000))} min ago</span>
        </div>
      ))}
      <div className="axp-smart-menus__row">
        <SelectField label="Kind" value={kind} options={MENU_TOPIC_KINDS.map((k) => ({ value: k, label: k }))} onChange={setKind} />
        <TextField label="Id" value={id} onChange={setId} placeholder="toolbar-tap-confirm" />
        <Button icon="plus" disabled={!id.trim()} onClick={() => void setTopics([{ kind, id: id.trim() }]).then(() => setId(''), (e) => rt.toast(String(e), 'danger', 'Menus'))}>Add</Button>
      </div>
      <Button icon="x" disabled={!m.topics.length} onClick={() => void clearTopics()}>Clear Talking about</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function MenusPage({ focus }: { focus?: string }) {
  const [tab, setTab] = useState<'sections' | 'look' | 'menus' | 'behaviour' | 'learning' | 'topics'>(focus ? 'menus' : 'sections');
  useEffect(() => { if (focus) setTab('menus'); }, [focus]);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>Menus</h1><p>Smart sections in every menu, and how every menu looks.</p></div></header>
      <Segmented label="Menus settings" value={tab} onChange={setTab} options={[
        { value: 'sections', label: 'Sections' }, { value: 'look', label: 'Look' }, { value: 'menus', label: 'Per menu' },
        { value: 'behaviour', label: 'Behaviour' }, { value: 'learning', label: 'Learning' }, { value: 'topics', label: 'Talking about' },
      ]} />
      {tab === 'sections' && <Container title="Sections" icon="layers"><SectionsPanel /></Container>}
      {tab === 'look' && <Container title="Look" icon="palette"><LookPanel /></Container>}
      {tab === 'menus' && <Container title="Per menu" icon="menu"><PerMenuPanel initial={focus} /></Container>}
      {tab === 'behaviour' && <Container title="Behaviour" icon="sliders"><BehaviourPanel /></Container>}
      {tab === 'learning' && <Container title="Learning" icon="chart"><LearningPanel /></Container>}
      {tab === 'topics' && <Container title="Talking about" icon="mic"><TopicsPanel /></Container>}
    </div>
  );
}

export const LOOK_DEFAULT = MENU_LOOK_DEFAULT;
