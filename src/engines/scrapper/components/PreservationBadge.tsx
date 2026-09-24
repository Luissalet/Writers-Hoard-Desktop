// ============================================
// Scrapper Engine — Preservation badge
// ============================================
//
// One small pill per clipping saying what is held locally. The level is in
// the visible text (and the tooltip explains it), never in the colour alone.

import { Link2, FileText, Archive, PlayCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { preservationLevel, type PreservationLevel } from '../preservation';
import type { Snapshot } from '../types';

const LEVELS: Record<
  PreservationLevel,
  { icon: LucideIcon; label: string; hint: string; tone: string }
> = {
  'link-only': {
    icon: Link2,
    label: 'scrapper.preservation.linkOnly',
    hint: 'scrapper.preservation.linkOnlyHint',
    tone: 'text-amber-400',
  },
  text: {
    icon: FileText,
    label: 'scrapper.preservation.text',
    hint: 'scrapper.preservation.textHint',
    tone: 'text-muted',
  },
  archived: {
    icon: Archive,
    label: 'scrapper.preservation.archived',
    hint: 'scrapper.preservation.archivedHint',
    tone: 'text-green-500',
  },
  media: {
    icon: PlayCircle,
    label: 'scrapper.preservation.media',
    hint: 'scrapper.preservation.mediaHint',
    tone: 'text-green-500',
  },
};

export default function PreservationBadge({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useTranslation();
  // A manual note has no link to lose — no badge to show.
  if (!snapshot.url?.trim()) return null;
  const level = preservationLevel(snapshot);
  const { icon: Icon, label, hint, tone } = LEVELS[level];
  return (
    <span
      data-preservation={level}
      title={t(hint)}
      className="inline-flex flex-shrink-0 items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-surface border border-border text-foreground whitespace-nowrap"
    >
      <Icon size={12} className={tone} aria-hidden="true" />
      {t(label)}
    </span>
  );
}
