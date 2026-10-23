import { useRef, useState } from 'react';
import { BookOpen, Clock, Library, Lightbulb, Layers, PenLine, PlayCircle, Trash2, Palette, Pin, Copy } from 'lucide-react';
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
  onDuplicate?: () => void;
  onColorChange?: (color: string) => void;
  onIconChange?: (icon: string) => void;
  onPin?: () => Promise<void>;
  index: number;
  /** Words across every writing in the project. */
  totalWords?: number;
  /** Whole local calendar days since the last writing was saved; null when none. */
  daysSinceEdit?: number | null;
  /** What "continue" would open — a chapter title, or an engine name. */
  /** A saga's books, shown as a shelf inside its card (each opens on its own). */
  books?: { id: string; title: string; words: number; daysSinceEdit: number | null }[];
  onOpenBook?: (id: string) => void;
  resumeLabel?: string;
  /** Opens `resumeLabel`. Omitted when there is nothing to resume. */
  onResume?: () => void;
}

export default function ProjectCard({
  project,
  onClick,
  onDelete,
  onDuplicate,
  onColorChange,
  onIconChange,
  onPin,
  totalWords = 0,
  daysSinceEdit = null,
  resumeLabel,
  onResume,
  books,
  onOpenBook,
}: ProjectCardProps) {
  const { t, locale } = useTranslation();
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [pinBusy,setPinBusy]=useState(false),[pinError,setPinError]=useState(false);
  const pinLabel=locale==='es'?(project.pinned?'Desfijar proyecto':'Fijar al principio'):(project.pinned?'Unpin project':'Pin to front');

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
    <article
      className="relative group cursor-pointer"
      onClick={onClick}
    >
      <div
        className="relative h-full overflow-hidden rounded-xl border border-border bg-surface hover:border-accent-gold/50 transition-colors duration-200"
      >
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
          <h3 className="font-semibold text-lg text-text-primary mb-1 group-hover:text-accent-gold transition">
            <button type="button" className="text-left break-words" onClick={event => { event.stopPropagation(); onClick(); }}>{project.title}</button>
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

          {books && books.length > 0 && (
            <div data-testid="project-card-books" className="mb-3 space-y-1" aria-label={t('projectCard.books').replace('{count}', String(books.length))}>
              <p className="text-[10px] uppercase tracking-wider text-text-dim">{t('projectCard.books').replace('{count}', String(books.length))}</p>
              {books.slice(0, 6).map(book => (
                <button key={book.id} type="button" data-testid={`project-card-book-${book.id}`} onClick={(e) => { e.stopPropagation(); onOpenBook?.(book.id); }}
                  className="flex w-full items-center gap-2 rounded border border-border/60 px-2 py-1 text-left text-xs text-text-primary hover:border-accent-gold/50 hover:bg-elevated">
                  <span className="min-w-0 flex-1 truncate">{book.title}</span>
                  <span className="shrink-0 text-text-dim">{book.words.toLocaleString()} {t('projectCard.wordsShort')}{book.daysSinceEdit !== null ? ` · ${book.daysSinceEdit === 0 ? t('projectCard.today') : t('projectCard.daysAgo').replace('{n}', String(book.daysSinceEdit))}` : ''}</span>
                </button>
              ))}
              {books.length > 6 && <p className="text-[10px] text-text-dim">+{books.length - 6}</p>}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-dim capitalize px-2 py-1 bg-elevated rounded">
              {t(`project.type.${project.type}`)}
            </span>
            <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition">
              {onPin&&<button type="button" aria-label={pinLabel} title={pinLabel} aria-pressed={project.pinned??false} disabled={pinBusy} onClick={event=>{event.stopPropagation();if(pinBusy)return;setPinBusy(true);setPinError(false);void onPin().catch(()=>setPinError(true)).finally(()=>setPinBusy(false));}} className="min-h-9 min-w-9 rounded-lg p-1.5 text-text-muted hover:bg-accent-gold/20 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent-gold"><Pin size={15} aria-hidden="true" className={project.pinned?'fill-accent-gold text-accent-gold':''}/></button>}
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
              {onDuplicate&&<button type="button" onClick={event=>{event.stopPropagation();onDuplicate();}} aria-label={locale==='es'?'Duplicar proyecto':'Duplicate project'} title={locale==='es'?'Duplicar proyecto':'Duplicate project'} className="min-h-9 min-w-9 rounded-lg p-1.5 text-text-muted hover:bg-accent-gold/20 focus-visible:outline-2 focus-visible:outline-accent-gold"><Copy size={15} aria-hidden="true"/></button>}
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
          {pinError&&<p role="alert" className="mt-2 text-xs text-danger">{locale==='es'?'No se ha cambiado la chincheta. Actualiza el proyecto e inténtalo de nuevo.':'The pin was not changed. Refresh the project and try again.'}</p>}
        </div>
      </div>
    </article>
  );
}
