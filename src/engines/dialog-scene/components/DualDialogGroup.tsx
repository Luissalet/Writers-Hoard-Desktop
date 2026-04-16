import { useState, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DialogBlock, BlockFormatting } from '../types';
import type { AutocompleteSuggestion } from './ScriptAutocomplete';
import ScriptAutocomplete from './ScriptAutocomplete';

interface DualDialogGroupProps {
  left: DialogBlock;
  right: DialogBlock;
  onUpdateLeft: (content: string, parenthetical?: string) => void;
  onUpdateRight: (content: string, parenthetical?: string) => void;
  onUpdateFormattingLeft: (formatting: BlockFormatting) => void;
  onUpdateFormattingRight: (formatting: BlockFormatting) => void;
  onDeleteLeft: () => void;
  onDeleteRight: () => void;
  /** Unlink the dual pairing — returns both blocks to normal */
  onUnpair: () => void;
  suggestions?: AutocompleteSuggestion[];
}

const FONT_FAMILIES: { key: BlockFormatting['fontFamily']; cls: string }[] = [
  { key: 'serif', cls: 'font-serif' },
  { key: 'sans', cls: 'font-sans' },
  { key: 'mono', cls: 'font-mono' },
];

const FONT_SIZES: { key: BlockFormatting['fontSize']; cls: string }[] = [
  { key: 'xs', cls: 'text-xs' },
  { key: 'sm', cls: 'text-sm' },
  { key: 'base', cls: 'text-base' },
  { key: 'lg', cls: 'text-lg' },
];

function fontCls(f?: BlockFormatting) {
  const family = FONT_FAMILIES.find((ff) => ff.key === (f?.fontFamily ?? 'serif'))?.cls ?? 'font-serif';
  const size = FONT_SIZES.find((fs) => fs.key === (f?.fontSize ?? 'sm'))?.cls ?? 'text-sm';
  return `${family} ${size}`;
}

function DualColumn({
  block,
  onUpdate,
  suggestions,
}: {
  block: DialogBlock;
  onUpdate: (content: string, parenthetical?: string) => void;
  suggestions?: AutocompleteSuggestion[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  return (
    <div className="flex-1 min-w-0">
      {/* Character header */}
      <div
        className="px-3 py-2 border-b border-border flex items-center gap-2"
        style={{ backgroundColor: block.characterColor + '15' }}
      >
        <div
          className="w-1.5 h-5 rounded-full flex-shrink-0"
          style={{ backgroundColor: block.characterColor }}
        />
        <span className="text-xs font-semibold text-text-primary truncate">
          {block.characterName}
        </span>
      </div>

      {/* Content */}
      <div className="px-3 py-2 bg-elevated">
        {block.parenthetical !== undefined && block.parenthetical !== '' && (
          <p className="text-[10px] italic text-text-muted mb-1">
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
            className={`w-full bg-transparent resize-none focus:outline-none border-none p-0 leading-relaxed text-text-primary ${fontCls(block.formatting)}`}
            rows={Math.max(2, Math.ceil(block.content.length / 30))}
            placeholder="Enter dialog..."
          />
          {suggestions && (
            <ScriptAutocomplete
              value={block.content}
              suggestions={suggestions.filter((s) => s.category === 'character')}
              anchorRef={textareaRef}
              active={showAutocomplete && block.content.startsWith('@')}
              onSelect={(s) => {
                onUpdate(s.label, block.parenthetical);
                setShowAutocomplete(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function DualDialogGroup({
  left,
  right,
  onUpdateLeft,
  onUpdateRight,
  onDeleteLeft,
  onDeleteRight,
  onUnpair,
  suggestions,
}: DualDialogGroupProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="group relative mb-3"
    >
      {/* Dual Dialog label */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-text-dim/60">
          DUAL DIALOGUE
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={onUnpair}
            className="px-2 py-0.5 text-[10px] text-text-dim hover:text-text-primary bg-border/30 rounded transition"
            title="Unpair dual dialogue"
          >
            Unpair
          </button>
          <button
            onClick={() => { onDeleteLeft(); onDeleteRight(); }}
            className="p-1 text-text-dim hover:text-danger hover:bg-danger/10 rounded transition"
            title="Delete both"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Side-by-side columns */}
      <div className="flex gap-2">
        <div className="flex-1 rounded-lg border border-border overflow-hidden">
          <DualColumn
            block={left}
            onUpdate={onUpdateLeft}
            suggestions={suggestions}
          />
        </div>
        <div className="flex-shrink-0 flex items-center">
          <div className="w-px h-full bg-border/50" />
        </div>
        <div className="flex-1 rounded-lg border border-border overflow-hidden">
          <DualColumn
            block={right}
            onUpdate={onUpdateRight}
            suggestions={suggestions}
          />
        </div>
      </div>
    </motion.div>
  );
}
