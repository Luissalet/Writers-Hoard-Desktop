// ============================================================================
// Compare — two to four pictures, and the recipe diff underneath
// ============================================================================
//
// This is the part that teaches. Two pictures side by side say "that one is
// better"; two pictures side by side with «steps 20→30 · seed changed · LoRA
// 0.80→1.00» underneath say WHY, and after a dozen of those the writer knows
// what the knobs do. No chat log can show this, because a chat log has no place
// to put a diff.

import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import type { InspirationImage } from '@/types';
import { diffRecipes, readRecipe } from '@/services/visualRef';

export interface CompareDialogProps {
  open: boolean;
  images: readonly InspirationImage[];
  onClose: () => void;
}

export default function CompareDialog({ open, images, onClose }: CompareDialogProps) {
  const { t } = useTranslation();
  const recipes = images.map((image) => (image.generation ? readRecipe(image.generation) : null));

  return (
    <Modal open={open} onClose={onClose} title={t('visualRef.compare.title')} wide>
      <div className="space-y-3">
        <div className={`grid gap-2 ${images.length > 2 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
          {images.map((image) => (
            <img key={image.id} src={image.imageData} alt="" className="w-full rounded-lg border border-border object-contain bg-deep/40" />
          ))}
        </div>
        <div className="space-y-2">
          {recipes.slice(1).map((recipe, index) => {
            const previous = recipes[index];
            const label = `${index + 1} → ${index + 2}`;
            if (!previous || !recipe) {
              return (
                <p key={label} className="text-[11px] text-text-dim">
                  {t('visualRef.compare.noRecipe').replace('{pair}', label)}
                </p>
              );
            }
            const differences = diffRecipes(previous, recipe);
            return (
              <div key={label} className="rounded-lg border border-border/60 bg-elevated/40 px-3 py-2">
                <p className="text-[10px] text-text-muted mb-1">{label}</p>
                {differences.length === 0 ? (
                  <p className="text-[11px] text-text-dim">{t('visualRef.compare.same')}</p>
                ) : (
                  <p className="text-[11px] text-text-primary font-mono break-words">
                    {differences
                      .map((difference) => {
                        const from = difference.before ?? '—';
                        const to = difference.after ?? '—';
                        // A whole prompt inside a one-line diff is unreadable;
                        // the point of the line is which knobs moved.
                        if (difference.field === 'prompt' || difference.field === 'negativePrompt') {
                          return `${difference.field} ${t('visualRef.compare.changed')}`;
                        }
                        return `${difference.field} ${from}→${to}`;
                      })
                      .join(' · ')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
