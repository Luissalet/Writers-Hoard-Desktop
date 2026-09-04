// ============================================================================
// The cast — the project's visual references, as faces
// ============================================================================
//
// This column is the reason the studio is a mode and not a chat: the writer's
// characters are objects on the left, permanently, and a generation is made by
// putting one of them into the composer. A chat log has nowhere to put this.
//
// It is also the part that works with no image backend at all. A reference with
// a portrait the writer uploaded and three lines describing her is a visual
// bible, and this column is how it is read.

import { useState } from 'react';
import { Plus, Trash2, UserRound } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { VisualRef } from '@/types/visualRef';

export interface CastColumnProps {
  refs: readonly VisualRef[];
  /** Gallery data URL per image id, for the avatars. */
  thumbnails: Readonly<Record<string, string>>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInsert: (ref: VisualRef) => void;
  onCreate: (name: string) => void;
  onDelete: (ref: VisualRef) => void;
}

export default function CastColumn({
  refs, thumbnails, selectedId, onSelect, onInsert, onCreate, onDelete,
}: CastColumnProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    onCreate(trimmed);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
        <UserRound size={13} />
        {t('visualRef.cast')}
      </h3>

      {refs.length === 0 ? (
        <p className="text-[11px] text-text-dim">{t('visualRef.cast.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {refs.map((ref) => {
            const portrait = ref.canonicalImageId ? thumbnails[ref.canonicalImageId] : undefined;
            return (
              <li key={ref.id}>
                <div
                  className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition ${
                    selectedId === ref.id
                      ? 'border-accent-gold/50 bg-accent-gold/10'
                      : 'border-border bg-elevated/40 hover:border-accent-gold/30'
                  }`}
                >
                  <button
                    type="button"
                    // Dragging one in is the fast path; a click has to work too,
                    // because a drag onto a textarea is not discoverable.
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('text/plain', ref.name)}
                    onClick={() => onInsert(ref)}
                    title={t('visualRef.cast.insert')}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    {portrait ? (
                      <img src={portrait} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0 border border-border" />
                    ) : (
                      <span className="w-7 h-7 rounded bg-deep/60 flex items-center justify-center flex-shrink-0 text-text-dim">
                        <UserRound size={13} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-[11px] text-text-primary truncate">{ref.name}</span>
                      <span className="block text-[9px] text-text-dim truncate">
                        {t(`visualRef.kind.${ref.kind}`)}
                        {ref.lora ? ` · ${t('visualRef.cast.hasLora')}` : ''}
                        {ref.heroSeed !== undefined ? ` · #${ref.heroSeed}` : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect(ref.id)}
                    title={t('visualRef.cast.edit')}
                    className="p-1 rounded text-text-dim hover:text-accent-gold transition"
                  >
                    <UserRound size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(ref)}
                    title={t('visualRef.cast.delete')}
                    className="p-1 rounded text-text-dim hover:text-danger transition opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          placeholder={t('visualRef.cast.newPlaceholder')}
          className="flex-1 min-w-0 px-2 py-1.5 bg-elevated border border-border rounded-lg text-[11px] text-text-primary outline-none focus:border-accent-gold transition"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim()}
          title={name.trim() ? t('visualRef.cast.new') : t('visualRef.reason.noName')}
          className="p-1.5 rounded-lg bg-accent-gold/15 text-accent-gold hover:bg-accent-gold/25 transition disabled:opacity-40"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}
