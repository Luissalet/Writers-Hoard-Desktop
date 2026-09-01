import { useRef } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Clock, Library, Lightbulb, Layers, PenLine, PlayCircle, Trash2, Palette } from 'lucide-react';
import { InlineIconPicker } from '@/components/common/IconPicker';
import { ProjectIcon } from '@/components/common/ProjectIcon';
import { useTranslation } from '@/i18n/useTranslation';
import type { Project } from '@/types';

const typeIcons = {
  saga: Library,
  standalone: BookOpen,
  collection: Layers,
  idea: Lightbulb,
};

const statusColors = {
  draft: 'bg-text-dim',
  'in-progress': 'bg-accent-amber',
  completed: 'bg-success',
};

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
  onDelete: () => void;
  onColorChange?: (color: string) => void;
  onIconChange?: (icon: string) => void;
  index: number;
  /** Words across every writing in the project. */
  totalWords?: number;
  /** Whole local calendar days since the last writing was saved; null when none. */
  daysSinceEdit?: number | null;
  /** What "continue" would open — a chapter title, or an engine name. */
  resumeLabel?: string;
  /** Opens `resumeLabel`. Omitted when there is nothing to resume. */
  onResume?: () => void;
}

export default function ProjectCard({
  project,
  onClick,
  onDelete,
  onColorChange,
  onIconChange,
  index,
  totalWords = 0,
  daysSinceEdit = null,
  resumeLabel,
  onResume,
}: ProjectCardProps) {
  const { t, locale } = useTranslation();
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Calendar days, already counted locally by the caller — so a chapter saved
  // last night reads as "yesterday", not "0 days ago".
  const editedLabel =
    daysSinceEdit === null
      ? null
      : daysSinceEdit <= 0
        ? t('projectCard.editedToday')
        : daysSinceEdit === 1
          ? t('projectCard.editedYesterday')
          : t('projectCard.editedDaysAgo').replace('{n}', String(daysSinceEdit));
  const showProgress = totalWords > 0 || editedLabel !== null;

  return (
    <motion.div
      className="relative group cursor-pointer"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      whileHover={{ y: -4 }}
      onClick={onClick}
    >
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-surface hover:border-accent-gold/50 transition-all duration-300 animate-pulse-gold"
        style={{
          background: `linear-gradient(135deg, ${project.color}15 0%, var(--color-surface) 50%, var(--color-deep) 100%)`,
        }}
      >
        {/* Glow effect */}
        <div
          className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition"
          style={{ backgroundColor: project.color }}
        />

        <div className="relative p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${project.color}25` }}
            >
              <ProjectIcon
                name={project.icon}
                fallback={typeIcons[project.type] ?? BookOpen}
                size={24}
                style={{ color: project.color }}
              />
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${statusColors[project.status]}`} />
              <span className="text-[10px] text-text-dim uppercase tracking-wider">
                {t(`project.status.${project.status}`)}
              </span>
            </div>
          </div>

          {/* Content */}
          <h3 className="font-serif font-bold text-lg text-text-primary mb-1 group-hover:text-accent-gold transition">
            {project.title}
          </h3>
          <p className="text-sm text-text-muted line-clamp-2 mb-3">
            {project.description || t('projectCard.noDescription')}
          </p>

          {/* Progress — the two facts that say whether this project is alive */}
          {showProgress && (
            <div className="flex items-center gap-3 mb-3 text-[11px] text-text-dim">
              <span className="flex items-center gap-1">
                <PenLine size={12} />
                {t('projectCard.words').replace('{n}', totalWords.toLocaleString(locale))}
              </span>
              {editedLabel && (
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {editedLabel}
                </span>
              )}
            </div>
          )}

          {/* Resume — the card's primary action once there is somewhere to go
              back to. The card itself still opens the project, for anyone who
              wants the project rather than the sentence they left unfinished. */}
          {onResume && resumeLabel && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onResume(); }}
              className="w-full flex items-center gap-1.5 mb-3 px-3 py-2 rounded-lg border border-accent-gold/30 bg-accent-gold/10 text-accent-gold text-xs font-semibold hover:bg-accent-gold/20 transition"
              title={t('projectCard.continue').replace('{name}', resumeLabel)}
            >
              <PlayCircle size={14} className="flex-shrink-0" />
              <span className="truncate">
                {t('projectCard.continue').replace('{name}', resumeLabel)}
              </span>
            </button>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-dim capitalize px-2 py-1 bg-elevated rounded">
              {t(`project.type.${project.type}`)}
            </span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              {onIconChange && (
                <InlineIconPicker
                  value={project.icon}
                  onChange={onIconChange}
                  color={project.color}
                />
              )}
              {onColorChange && (
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); colorInputRef.current?.click(); }}
                    className="p-1.5 rounded-lg hover:bg-accent-gold/20 transition"
                    title={t('projectCard.changeColor')}
                  >
                    <Palette size={14} className="text-accent-gold" />
                  </button>
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={project.color}
                    onChange={(e) => { e.stopPropagation(); onColorChange(e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute opacity-0 w-0 h-0 pointer-events-none"
                    tabIndex={-1}
                  />
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-1.5 rounded-lg hover:bg-danger/20 transition"
                aria-label={t('common.delete')}
                title={t('common.delete')}
              >
                <Trash2 size={14} className="text-danger" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
