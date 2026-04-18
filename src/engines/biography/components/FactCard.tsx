import { useState } from 'react';
import { Trash2, GripVertical, ChevronDown, Check, AlertCircle, HelpCircle, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import type { BiographyFact } from '../types';
import { BIOGRAPHY_CATEGORIES, CONFIDENCE_LEVELS } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface FactCardProps {
  fact: BiographyFact;
  onEdit: () => void;
  onDelete: () => void;
  isDragging?: boolean;
}

export default function FactCard({ fact, onEdit, onDelete, isDragging }: FactCardProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const category = BIOGRAPHY_CATEGORIES[fact.category];
  const confidence = CONFIDENCE_LEVELS[fact.confidence];

  const confidenceIcon = {
    check: <Check size={13} />,
    questionmark: <HelpCircle size={13} />,
    tilde: <Minus size={13} />,
    exclamation: <AlertCircle size={13} />,
  }[confidence.icon];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className={`group relative border border-border rounded-lg p-4 transition ${
        isDragging
          ? 'bg-accent-gold/20 border-accent-gold'
          : 'bg-elevated hover:border-accent-gold/50 hover:bg-elevated/80'
      }`}
    >
      {/* Content area */}
      <div className="flex gap-3 cursor-pointer" onClick={() => !isDragging && setIsExpanded(!isExpanded)}>
        {/* Category badge */}
        <div className={`flex-shrink-0 w-2 h-12 rounded-full bg-gradient-to-b ${category.color}`} />

        {/* Main content */}
        <div className="flex-grow min-w-0">
          <div className="flex items-start gap-2 mb-1">
            <div className="flex-grow min-w-0">
              <h4 className="text-sm font-serif font-semibold text-text-primary truncate">
                {fact.title}
              </h4>
              {fact.date && (
                <p className="text-xs text-text-muted mt-0.5">
                  {fact.date}
                  {fact.endDate && ` – ${fact.endDate}`}
                </p>
              )}
            </div>
          </div>

          {/* Content preview */}
          <p className="text-sm text-text-muted line-clamp-2">
            {fact.content.replace(/<[^>]*>/g, '').slice(0, 100)}
            {fact.content.replace(/<[^>]*>/g, '').length > 100 ? '...' : ''}
          </p>

          {/* Tags and metadata row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`inline-flex items-center gap-0.5 px-2 py-1 rounded text-[10px] font-medium ${confidence.color}`}>
              {confidenceIcon}
              {confidence.label}
            </span>

            {fact.sources.length > 0 && (
              <span className="inline-flex items-center px-2 py-1 rounded bg-border text-[10px] font-medium text-text-muted">
                {fact.sources.length} source{fact.sources.length !== 1 ? 's' : ''}
              </span>
            )}

            {fact.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {fact.tags.slice(0, 2).map(tag => (
                  <span key={tag} className="inline-flex px-2 py-1 rounded bg-border/50 text-[10px] text-text-muted">
                    #{tag}
                  </span>
                ))}
                {fact.tags.length > 2 && (
                  <span className="text-[10px] text-text-dim">+{fact.tags.length - 2}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Expand indicator */}
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0 mt-0.5"
        >
          <ChevronDown size={16} className="text-text-muted" />
        </motion.div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-3 pt-3 border-t border-border space-y-3"
        >
          {/* Full content */}
          <div className="prose prose-sm prose-invert max-w-none">
            <div
              className="text-sm text-text-primary"
              dangerouslySetInnerHTML={{ __html: fact.content }}
            />
          </div>

          {/* Sources */}
          {fact.sources.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted mb-2">Sources:</p>
              <div className="space-y-1.5">
                {fact.sources.map((source, idx) => (
                  <div key={idx} className="text-xs text-text-dim p-2 bg-surface/50 rounded border border-border/50">
                    <div className="font-medium text-text-muted mb-0.5">
                      {source.type === 'snapshot' && '📸 Snapshot'}
                      {source.type === 'link' && '🔗 Link'}
                      {source.type === 'manual' && '✏️ Manual'}
                      {source.type === 'interview' && '🎤 Interview'}
                    </div>
                    <p>{source.description}</p>
                    {source.url && (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-gold hover:text-accent-amber mt-1 inline-block"
                      >
                        {source.url}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Action buttons (hover) */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 transition text-xs"
          title={t('biography.editFact')}
        >
          ✎
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
          title={t('biography.deleteFact')}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Drag handle */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 opacity-0 group-hover:opacity-100 transition text-text-muted">
        <GripVertical size={14} />
      </div>
    </motion.div>
  );
}
