import { useState, useRef, useMemo, useEffect } from 'react';
import { useDebouncedField } from '@/engines/_shared';
import { Trash2, GripVertical, Type, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DialogBlock, DialogBlockType, BlockFormatting } from '../types';
import ScriptAutocomplete, { type AutocompleteSuggestion } from './ScriptAutocomplete';
import { useTranslation } from '@/i18n/useTranslation';

interface DialogBlockComponentProps {
  block: DialogBlock;
  onUpdate: (content: string, parenthetical?: string) => Promise<void>;
  onUpdateFormatting: (formatting: BlockFormatting) => void;
  /** Tab-cycling of the block type; omit to disable (e.g. dual dialogue). */
  onChangeType?: (type: DialogBlockType) => void;
  onDelete: () => void;
  isDragging?: boolean;
  /** dnd-kit listeners spread onto the drag handle. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
  /** Autocomplete suggestions for script intelligence */
  suggestions?: AutocompleteSuggestion[];
}

/**
 * Tab cycles the block through its types (Shift+Tab reverses) — the Final
 * Draft muscle-memory gesture. `dialog` is skipped when the block has no
 * character name: a block born non-dialog would otherwise render an empty
 * name bar, while a block born dialog keeps its name through the loop and
 * restores intact.
 */
const TYPE_CYCLE: DialogBlockType[] = ['dialog', 'action', 'stage-direction', 'transition', 'slug', 'note'];

const FONT_FAMILIES: { key: BlockFormatting['fontFamily']; label: string; cls: string }[] = [
  { key: 'serif', label: 'Serif', cls: 'font-serif' },
  { key: 'sans', label: 'Sans', cls: 'font-sans' },
  { key: 'mono', label: 'Mono', cls: 'font-mono' },
];

const FONT_SIZES: { key: BlockFormatting['fontSize']; label: string; cls: string }[] = [
  { key: 'xs', label: '10', cls: 'text-xs' },
  { key: 'sm', label: '12', cls: 'text-sm' },
  { key: 'base', label: '14', cls: 'text-base' },
  { key: 'lg', label: '16', cls: 'text-lg' },
];

function fontCls(f?: BlockFormatting) {
  const family = FONT_FAMILIES.find((ff) => ff.key === (f?.fontFamily ?? 'serif'))?.cls ?? 'font-serif';
  const size = FONT_SIZES.find((fs) => fs.key === (f?.fontSize ?? 'sm'))?.cls ?? 'text-sm';
  return `${family} ${size}`;
}

function FormatToolbar({
  formatting,
  onChange,
}: {
  formatting?: BlockFormatting;
  onChange: (f: BlockFormatting) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = { fontFamily: formatting?.fontFamily ?? 'serif', fontSize: formatting?.fontSize ?? 'sm' };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 p-1 text-text-dim hover:text-text-muted rounded transition"
        title={t('dialogScene.textFormat')}
      >
        <Type size={12} />
        <ChevronDown size={10} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full right-0 mt-1 z-20 bg-elevated border border-border rounded-lg p-3 shadow-xl min-w-[160px]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] text-text-dim mb-1.5 font-semibold uppercase tracking-wide">{t('dialogScene.font')}</p>
            <div className="flex gap-1 mb-3">
              {FONT_FAMILIES.map((ff) => (
                <button
                  key={ff.key}
                  onClick={() => { onChange({ ...current, fontFamily: ff.key }); }}
                  className={`px-2 py-1 text-xs rounded transition ${
                    current.fontFamily === ff.key
                      ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/40'
                      : 'border border-border text-text-muted hover:text-text-primary'
                  } ${ff.cls}`}
                >
                  {ff.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-text-dim mb-1.5 font-semibold uppercase tracking-wide">{t('dialogScene.size')}</p>
            <div className="flex gap-1">
              {FONT_SIZES.map((fs) => (
                <button
                  key={fs.key}
                  onClick={() => { onChange({ ...current, fontSize: fs.key }); }}
                  className={`px-2 py-1 text-xs rounded transition ${
                    current.fontSize === fs.key
                      ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/40'
                      : 'border border-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  {fs.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Block type labels & styling ───

const BLOCK_META: Record<
  string,
  { labelKey: string; wrapCls: string; textCls: string; align: string }
> = {
  'stage-direction': {
    labelKey: 'dialogScene.block.stage-direction',
    wrapCls: 'bg-elevated/50',
    textCls: 'italic text-text-muted',
    align: 'text-center',
  },
  action: {
    labelKey: 'dialogScene.block.action',
    wrapCls: 'bg-elevated/30',
    textCls: 'text-text-primary',
    align: 'text-left',
  },
  transition: {
    labelKey: 'dialogScene.block.transition',
    wrapCls: 'bg-elevated/30 border-r-4 border-r-accent-gold/40',
    textCls: 'uppercase font-semibold text-text-muted tracking-wide',
    align: 'text-right',
  },
  note: {
    labelKey: 'dialogScene.block.note',
    wrapCls: 'bg-amber-950/20 border-l-4 border-l-amber-500/40',
    textCls: 'text-amber-200/80 italic',
    align: 'text-left',
  },
  slug: {
    labelKey: 'dialogScene.block.slug',
    wrapCls: 'bg-elevated/40',
    textCls: 'uppercase font-bold text-text-primary tracking-wider',
    align: 'text-left',
  },
};

export default function DialogBlockComponent({
  block,
  onUpdate,
  onUpdateFormatting,
  onChangeType,
  onDelete,
  isDragging,
  dragHandleProps,
  suggestions = [],
}: DialogBlockComponentProps) {
  const { t } = useTranslation();
  const isDialog = block.type === 'dialog';
  const meta = BLOCK_META[block.type];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingRefocus = useRef<number | null>(null);

  // Buffered. Every keystroke used to be a Dexie write plus a full refresh of
  // the scene, with the textarea `value`-bound to the row coming back — so a
  // refresh landing mid-word reinstated older text and threw the caret to the
  // end. In the script editor of all places.
  const contentField = useDebouncedField(block.content, (content) =>
    onUpdate(content, block.parenthetical),
  );
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  // ── Autocomplete scope ────────────────────────────────────────────────
  //
  // The suggestion list used to be filtered against the WHOLE block and
  // accepting one replaced the WHOLE block. That is fine for a one-word
  // character cue and destructive everywhere else: an action paragraph that
  // happened to contain "CUT" offered "CUT TO:", and taking it deleted the
  // paragraph.
  //
  // The unit is the LINE, not the block — a cue, a transition and a scene
  // heading are all line-shaped. So the query is the current line up to the
  // caret, and accepting replaces exactly that span, leaving the rest of the
  // block (and anything after the caret on that line) untouched.
  const [caret, setCaret] = useState(0);

  const lineStartOf = (text: string, pos: number) =>
    text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;

  const activeLine = useMemo(() => {
    const value = contentField.value;
    const pos = Math.min(caret, value.length);
    const start = lineStartOf(value, pos);
    return { start, end: pos, text: value.slice(start, pos) };
  }, [contentField.value, caret]);

  const applySuggestion = (suggestion: AutocompleteSuggestion) => {
    const value = contentField.value;
    // The DOM is the source of truth for the caret at accept time — the user
    // may have moved it since the last change event.
    const pos = Math.min(textareaRef.current?.selectionStart ?? activeLine.end, value.length);
    const start = lineStartOf(value, pos);
    const next = value.slice(0, start) + suggestion.label + value.slice(pos);

    contentField.onChange(next);
    contentField.flush();
    setShowAutocomplete(false);

    const nextCaret = start + suggestion.label.length;
    setCaret(nextCaret);
    window.requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const caretBindings = {
    onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart ?? 0),
    onClick: (e: React.MouseEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart ?? 0),
  };

  // ── Tab type-cycling ──────────────────────────────────────────────────
  //
  // ScriptAutocomplete attaches a NATIVE keydown listener directly on the
  // textarea node while its list is non-empty and preventDefaults Tab to
  // accept a suggestion. A native listener on the target runs before React's
  // root-delegated synthetic handler, so bailing on `e.defaultPrevented`
  // guarantees "accept suggestion" always wins over cycling.
  const handleTabCycle = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!onChangeType) return;
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.defaultPrevented) return; // autocomplete consumed it
    if (block.dualGroupId) return; // a type change would orphan the pair
    e.preventDefault();
    const cycle = block.characterName
      ? TYPE_CYCLE
      : TYPE_CYCLE.filter((x) => x !== 'dialog');
    const idx = cycle.indexOf(block.type);
    const next =
      idx === -1
        ? (e.shiftKey ? cycle[cycle.length - 1] : cycle[0])
        : cycle[(idx + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length];
    pendingRefocus.current = e.currentTarget.selectionStart ?? contentField.value.length;
    // Commit buffered keystrokes BEFORE the type write, so the refresh that
    // follows adopts the text the author just typed.
    contentField.flush();
    onChangeType(next);
  };

  // Refocus after React commits the swapped subtree: dialog and non-dialog
  // render different textareas, and the instance (keyed by block.id in the
  // parent) survives the type change — only the DOM node is replaced.
  useEffect(() => {
    if (pendingRefocus.current === null) return;
    const pos = pendingRefocus.current;
    pendingRefocus.current = null;
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    const clamped = Math.min(pos, node.value.length);
    node.setSelectionRange(clamped, clamped);
  }, [block.type]);

  // Filter suggestions by block type context
  const contextSuggestions = suggestions.filter((s) => {
    if (block.type === 'slug') return s.category === 'location' || s.label.startsWith('INT') || s.label.startsWith('EXT');
    if (block.type === 'transition') return s.category === 'transition';
    return true;
  });

  // ─── Non-dialog block types (stage-direction, action, transition, note, slug) ───
  if (!isDialog && meta) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="group relative mb-3"
      >
        <div
          className={`rounded-lg border border-border px-4 py-3 transition ${meta.wrapCls} ${
            isDragging ? 'opacity-50' : ''
          }`}
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-text-dim/60">
              {t(meta.labelKey)}
            </span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              <FormatToolbar formatting={block.formatting} onChange={onUpdateFormatting} />
              <button
                {...dragHandleProps}
                className="p-1 text-text-dim hover:text-text-primary cursor-grab active:cursor-grabbing transition"
                title={t('common.dragToReorder')}
              >
                <GripVertical size={14} />
              </button>
              <button
                onClick={onDelete}
                className="p-1 text-text-dim hover:text-danger hover:bg-danger/10 rounded transition"
                title={t('dialogScene.deleteBlock')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Editable content */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={contentField.value}
              onChange={(e) => {
                contentField.onChange(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
              }}
              {...caretBindings}
              onKeyDown={handleTabCycle}
              onFocus={() => setShowAutocomplete(true)}
              onBlur={() => {
                contentField.onBlur();
                setTimeout(() => setShowAutocomplete(false), 200);
              }}
              className={`w-full bg-transparent resize-none focus:outline-none border-none p-0 leading-relaxed ${meta.textCls} ${meta.align} ${fontCls(block.formatting)}`}
              rows={Math.max(1, contentField.value.split('\n').length, Math.ceil(contentField.value.length / 60))}
              placeholder={t('dialogScene.blockPlaceholder').replace('{type}', t(meta.labelKey).toLowerCase())}
            />
            <ScriptAutocomplete
              value={activeLine.text}
              suggestions={contextSuggestions}
              anchorRef={textareaRef}
              active={showAutocomplete && activeLine.text.trim().length > 0}
              onSelect={applySuggestion}
            />
          </div>
        </div>
      </motion.div>
    );
  }

  // ─── Dialog block ───
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="group relative mb-3"
    >
      <div
        className={`rounded-lg border border-border overflow-hidden transition ${
          isDragging ? 'opacity-50' : ''
        }`}
      >
        {/* Character name bar with color stripe */}
        <div
          className="px-4 py-2 flex items-center gap-2 border-b border-border"
          style={{ backgroundColor: block.characterColor + '15' }}
        >
          <div
            className="w-1.5 h-6 rounded-full flex-shrink-0"
            style={{ backgroundColor: block.characterColor }}
          />
          <span className="text-sm font-semibold text-text-primary flex-1">
            {block.characterName}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            <FormatToolbar formatting={block.formatting} onChange={onUpdateFormatting} />
            <button
              {...dragHandleProps}
              className="p-1 text-text-dim hover:text-text-primary cursor-grab active:cursor-grabbing transition"
              title={t('common.dragToReorder')}
            >
              <GripVertical size={14} />
            </button>
            <button
              onClick={onDelete}
              className="p-1 text-text-dim hover:text-danger hover:bg-danger/10 rounded transition"
              title={t('dialogScene.deleteBlock')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Dialog content */}
        <div className="px-4 py-3 bg-elevated">
          {block.parenthetical !== undefined && block.parenthetical !== '' && (
            <p className="text-xs italic text-text-muted mb-2">
              ({block.parenthetical})
            </p>
          )}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={contentField.value}
              onChange={(e) => {
                contentField.onChange(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
              }}
              {...caretBindings}
              onKeyDown={handleTabCycle}
              onFocus={() => setShowAutocomplete(true)}
              onBlur={() => {
                contentField.onBlur();
                setTimeout(() => setShowAutocomplete(false), 200);
              }}
              className={`w-full bg-elevated text-text-primary resize-none focus:outline-none border-none p-0 leading-relaxed ${fontCls(block.formatting)}`}
              rows={Math.max(2, contentField.value.split('\n').length, Math.ceil(contentField.value.length / 60))}
              placeholder={t('dialogScene.dialogPlaceholder')}
            />
            {/* `@` opens a character mention on the CURRENT line — it used to
                require the whole block to start with '@', so a mention was only
                ever possible as the very first thing in a speech. */}
            <ScriptAutocomplete
              value={activeLine.text.slice(1)}
              suggestions={contextSuggestions.filter((s) => s.category === 'character')}
              anchorRef={textareaRef}
              active={showAutocomplete && activeLine.text.startsWith('@')}
              acceptOnEnter
              onSelect={applySuggestion}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
