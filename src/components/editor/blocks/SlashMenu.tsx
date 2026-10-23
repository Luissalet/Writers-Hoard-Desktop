// The "/" menu: typing a slash at the start of a line or after a space opens a
// list of blocks to insert, filtered by what follows the slash. Arrow keys,
// Enter or a click choose; Escape closes it until the slash is retyped.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { createSlashMenuPlugin, INACTIVE, slashMatches, slashMenuKey, type SlashItem, type SlashState } from './slashCommands';

/** The menu itself, drawn over the editor at the slash. */
export default function SlashMenu({ editor, wrapperRef, locale }: { editor: Editor | null; wrapperRef: RefObject<HTMLDivElement | null>; locale: string }) {
  const [state, setState] = useState<SlashState>(INACTIVE);
  // Where the menu sits, measured when the editor changes (never during render).
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // The highlighted item belongs to one slash and query; a new one starts at the top.
  const [pick, setPick] = useState({ key: '', index: 0 });
  const key = `${state.from}:${state.query}`;
  const index = pick.key === key ? pick.index : 0;
  const setIndex = (value: number) => setPick({ key, index: value });
  const items = state.active ? slashMatches(state.query, locale) : [];
  const at = Math.min(index, Math.max(0, items.length - 1));
  const choose = (item: SlashItem | undefined) => {
    if (!editor || !item) return;
    editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run();
    item.run(editor);
  };
  // What the key handler, set up once per editor, needs to see now.
  const live = useRef<{ items: SlashItem[]; index: number; key: string; state: SlashState; choose: (item: SlashItem | undefined) => void }>({ items: [], index: 0, key: '', state: INACTIVE, choose: () => undefined });
  useLayoutEffect(() => { live.current = { items, index: at, key, state, choose }; });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onKey = (event: KeyboardEvent) => {
      const { items: list, index: at, state: current } = live.current;
      if (event.key === 'Escape') { editor.view.dispatch(editor.state.tr.setMeta(slashMenuKey, { dismiss: current.from })); return true; }
      if (!list.length) return false;
      if (event.key === 'ArrowDown') { setPick({ key: live.current.key, index: (at + 1) % list.length }); return true; }
      if (event.key === 'ArrowUp') { setPick({ key: live.current.key, index: (at - 1 + list.length) % list.length }); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { live.current.choose(list[at]); return true; }
      return false;
    };
    // First in line, so Enter, Tab and the arrows reach the menu before the editor's own keys.
    editor.registerPlugin(createSlashMenuPlugin(onKey), (plugin, plugins) => [plugin, ...plugins]);
    const update = () => {
      const next = slashMenuKey.getState(editor.state) ?? INACTIVE;
      setState(previous => (previous.active === next.active && previous.query === next.query && previous.from === next.from ? previous : next));
      if (!next.active || !wrapperRef.current) { setPlace(null); return; }
      try {
        const coords = editor.view.coordsAtPos(next.from), box = wrapperRef.current.getBoundingClientRect();
        setPlace(previous => { const left = Math.max(4, coords.left - box.left), top = coords.bottom - box.top + 6; return previous && previous.left === left && previous.top === top ? previous : { left, top }; });
      } catch { setPlace(null); }
    };
    editor.on('transaction', update);
    return () => { editor.off('transaction', update); if (!editor.isDestroyed) editor.unregisterPlugin(slashMenuKey); };
  }, [editor, wrapperRef]);
  if (!editor || !state.active || !items.length || !place) return null;
  return <div role="listbox" data-testid="slash-menu" aria-label={locale === 'en' ? 'Insert a block' : 'Insertar un bloque'} className="absolute z-40 max-h-72 w-60 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-2xl" style={{ left: place.left, top: place.top }} onMouseDown={event => event.preventDefault()}>
    {items.map((item, i) => { const Icon = item.icon; return <button key={item.id} type="button" role="option" aria-selected={i === at} data-testid={`slash-${item.id}`} onClick={() => choose(item)} onMouseEnter={() => setIndex(i)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${i === at ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-primary hover:bg-elevated'}`}><Icon size={15} aria-hidden="true" />{locale === 'en' ? item.en : item.es}</button>; })}
  </div>;
}
