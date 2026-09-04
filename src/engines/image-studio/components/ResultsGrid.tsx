// ============================================================================
// Results — batches, newest on top, with the actions that make them useful
// ============================================================================
//
// A grid, not a stream. The chat metaphor is actively wrong for pictures: it
// hides the parameters, it makes history unbrowsable, and it gives no place to
// put the one action that matters most — the culling click that turns a good
// generation into training data.
//
// Every action that cannot run right now stays here, disabled, carrying the
// reason it cannot. A writer who never sees "Make this the canonical portrait"
// because no reference is selected concludes the studio cannot do it.

import { Copy, Dices, Layers, RefreshCw, Star, Trash2, Anchor, GitCompare, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { InspirationImage } from '@/types';
import type { Availability } from '../studioModel';

export interface ResultBatch {
  /** The generation stamp every image of one call shares. */
  at: number;
  images: InspirationImage[];
}

export interface ResultsGridProps {
  batches: readonly ResultBatch[];
  compareIds: readonly string[];
  onToggleCompare: (id: string) => void;
  onIterate: (image: InspirationImage) => void;
  onVariations: (image: InspirationImage) => void;
  /** Put this picture's seed in the composer without touching anything else. */
  onUseSeed: (image: InspirationImage) => void;
  onPinSeed: (image: InspirationImage) => void;
  onCanonical: (image: InspirationImage) => void;
  onAddToSet: (image: InspirationImage) => void;
  onKeep: (image: InspirationImage) => void;
  onDiscard: (image: InspirationImage) => void;
  /** Availability of every ref-dependent action, with its reason. */
  refActions: Availability;
  generateAction: Availability;
  seedAction: (image: InspirationImage) => Availability;
}

/** What an X/Y/Z cell varied, read defensively off the stored row. */
function gridLabel(image: InspirationImage): string | undefined {
  const info = image.generation as (typeof image.generation & { gridLabel?: string }) | undefined;
  return typeof info?.gridLabel === 'string' ? info.gridLabel : undefined;
}

/** One action button: never hidden, and never disabled without saying why. */
function Action({
  icon: Icon, label, availability, onClick, active,
}: {
  icon: typeof Star;
  label: string;
  availability: Availability;
  onClick: () => void;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const reason = availability.enabled ? label : t(availability.reasonKey ?? 'visualRef.reason.unavailable');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!availability.enabled}
      title={reason}
      aria-label={reason}
      className={`p-1 rounded transition disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? 'text-accent-gold' : 'text-text-dim hover:text-accent-gold'
      }`}
    >
      <Icon size={11} />
    </button>
  );
}

export default function ResultsGrid({
  batches, compareIds, onToggleCompare, onIterate, onVariations, onUseSeed, onPinSeed,
  onCanonical, onAddToSet, onKeep, onDiscard, refActions, generateAction, seedAction,
}: ResultsGridProps) {
  const { t } = useTranslation();

  if (batches.length === 0) {
    return <p className="text-[11px] text-text-dim">{t('visualRef.results.empty')}</p>;
  }

  return (
    <div className="space-y-4">
      {batches.map((batch) => (
        <div key={batch.at} className="space-y-1.5">
          <p className="text-[10px] text-text-dim font-mono">
            {new Date(batch.at).toLocaleString()} · {batch.images.length}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {batch.images.map((image) => {
              const kept = image.tags.includes('keep');
              const comparing = compareIds.includes(image.id);
              return (
                <div
                  key={image.id}
                  className={`rounded-lg overflow-hidden border bg-elevated ${
                    comparing ? 'border-accent-gold' : 'border-border'
                  }`}
                >
                  <button type="button" onClick={() => onToggleCompare(image.id)} className="block w-full" title={t('visualRef.action.compare')}>
                    <img src={image.thumbnailData ?? image.imageData} alt="" className="w-full aspect-square object-cover" />
                  </button>
                  <div className="p-1.5 space-y-1">
                    {/* The X/Y/Z label goes above the provenance: in a grid it
                        is the only thing the writer is reading. */}
                    {gridLabel(image) && (
                      <p className="text-[9px] text-accent-gold font-mono truncate" title={gridLabel(image)}>
                        {gridLabel(image)}
                      </p>
                    )}
                    <p className="text-[9px] text-text-dim font-mono truncate">
                      {image.generation?.modelId}
                      {image.generation?.seed !== undefined ? ` · #${image.generation.seed}` : ''}
                    </p>
                    <div className="flex items-center gap-0.5 flex-wrap">
                      <Action icon={Star} label={t('visualRef.action.keep')} availability={{ enabled: true }} onClick={() => onKeep(image)} active={kept} />
                      <Action icon={Copy} label={t('visualRef.action.iterate')} availability={{ enabled: true }} onClick={() => onIterate(image)} />
                      <Action icon={RefreshCw} label={t('visualRef.action.variations')} availability={generateAction} onClick={() => onVariations(image)} />
                      <Action
                        icon={Dices}
                        label={t('visualRef.action.useSeed')}
                        availability={image.generation?.seed === undefined
                          ? { enabled: false, reasonKey: 'visualRef.reason.noSeedRecorded' }
                          : { enabled: true }}
                        onClick={() => onUseSeed(image)}
                      />
                      <Action icon={Anchor} label={t('visualRef.action.pinSeed')} availability={seedAction(image)} onClick={() => onPinSeed(image)} />
                      <Action icon={Layers} label={t('visualRef.action.canonical')} availability={refActions} onClick={() => onCanonical(image)} />
                      <Action icon={Plus} label={t('visualRef.action.addToSet')} availability={refActions} onClick={() => onAddToSet(image)} />
                      <Action icon={GitCompare} label={t('visualRef.action.compare')} availability={{ enabled: true }} onClick={() => onToggleCompare(image.id)} active={comparing} />
                      <span className="ml-auto">
                        <Action icon={Trash2} label={t('visualRef.action.discard')} availability={{ enabled: true }} onClick={() => onDiscard(image)} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
