import { useState, useRef } from 'react';
import { Trash2, GripVertical, Type, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DialogBlock, BlockFormatting } from '../types';
import ScriptAutocomplete, { type AutocompleteSuggestion } from './ScriptAutocomplete';
import { useTranslation } from '@/i18n/useTranslation';

interface DialogBlockComponentProps {
  block: DialogBlock;
  onUpdate: (content: string, parenthetical?: string) => void;
  onUpdateFormatting: (formatting: BlockFormatting) => void;
  onDelete: () => void;
  isDragging?: boolean;
  dragHandleProps?: any;
  /** Autocomplete suggestions for script intelligence */
  suggestions?: AutocompleteSuggestion[];
}

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
  { label: string; wrapCls: string; textCls: string; align: string }
> = {
  'stage-direction': {
    label: 'STAGE DIRECTION',
    wrapCls: 'bg-elevated/50',
    textCls: 'italic text-text-muted',
    align: 'text-center',
  },
  action: {
    label: 'ACTION',
    wrapCls: 'bg-elevated/30',
    textCls: 'text-text-primary',
    align: 'text-left',
  },
  transition: {
    label: 'TRANSITION',
    wrapCls: 'bg-elevated/30 border-r-4 border-r-accent-gold/40',
    textCls: 'uppercase font-semibold text-text-muted tracking-wide',
    align: 'text-right',
  },
  note: {
    label: 'NOTE',
    wrapCls: 'bg-amber-950/20 border-l-4 border-l-amber-500/40',
    textCls: 'text-amber-200/80 italic',
    align: 'text-left',
  },
  slug: {
    label: 'SCENE HEADING',
    wrapCls: 'bg-elevated/40',
    textCls: 'uppercase font-bold text-text-primary tracking-wider',
    align: 'text-left',
  },
};

export default function DialogBlockComponent({
  block,
  onUpdate,
  onUpdateFormatting,
  onDelete,
  isDragging,
  dragHandleProps,
  suggestions = [],
}: DialogBlockComponentProps) {
  const { t } = useTranslation();
  const isDialog = block.type === 'dialog';
  const meta = BLOCK_META[block.type];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);

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
              {meta.label}
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
              value={block.content}
              onChange={(e) => onUpdate(e.target.value)}
              onFocus={() => setShowAutocomplete(true)}
              onBlur={() => setTimeout(() => setShowAutocomplete(false), 200)}
              className={`w-full bg-transparent resize-none focus:outline-none border-none p-0 leading-relaxed ${meta.textCls} ${meta.align} ${fontCls(block.formatting)}`}
              rows={Math.max(1, Math.ceil(block.content.length / 60))}
              placeholder={`Enter ${meta.label.toLowerCase()}...`}
            />
            <ScriptAutocomplete
              value={block.content}
              suggestions={contextSuggestions}
              anchorRef={textareaRef}
              active={showAutocomplete && block.content.length > 0}
              onSelect={(s) => {
                onUpdate(s.label);
                setShowAutocomplete(false);
              }}
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
              value={block.content}
              onChange={(e) => onUpdate(e.target.value, block.parenthetical)}
              onFocus={() => setShowAutocomplete(true)}
              onBlur={() => setTimeout(() => setShowAutocomplete(false), 200)}
              className={`w-full bg-elevated text-text-primary resize-none focus:outline-none border-none p-0 leading-relaxed ${fontCls(block.formatting)}`}
              rows={Math.max(2, Math.ceil(block.content.length / 60))}
              placeholder={t('dialogScene.dialogPlaceholder')}
            />
            <ScriptAutocomplete
              value={block.content}
              suggestions={contextSuggestions.filter((s) => s.category === 'character')}
              anchorRef={textareaRef}
              active={showAutocomplete && block.content.length > 0 && block.content.startsWith('@')}
              onSelect={(s) => {
                onUpdate(s.label, block.parenthetical);
                setShowAutocomplete(false);
              }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
