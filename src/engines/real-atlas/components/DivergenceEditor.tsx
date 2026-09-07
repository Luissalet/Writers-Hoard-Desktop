import { useTranslation } from '@/i18n/useTranslation';
import TagInput from '@/components/common/TagInput';
import { toast } from '@/components/common/toast';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { DIVERGENCE_CATEGORIES, type AtlasDivergence, type AtlasPlace, type DivergenceCategory } from '../types';
import { EditorHeader, Field, inputClass, selectClass, textareaClass } from './fields';
import { useRowDraft, type RowDraftStore } from './useRowDraft';

interface DivergenceDraft {
  title: string;
  category: DivergenceCategory;
  placeId: string;
  reality: string;
  fiction: string;
  reason: string;
  since: string;
  tags: string[];
}

function toDraft(row: AtlasDivergence): DivergenceDraft {
  return {
    title: row.title,
    category: row.category,
    placeId: row.placeId ?? '',
    reality: row.reality,
    fiction: row.fiction,
    reason: row.reason,
    since: row.since ?? '',
    tags: row.tags,
  };
}

function fromDraft(draft: DivergenceDraft, untitled: string): Partial<AtlasDivergence> {
  return {
    title: draft.title.trim() || untitled,
    category: draft.category,
    placeId: draft.placeId || undefined,
    reality: draft.reality,
    fiction: draft.fiction,
    reason: draft.reason,
    since: draft.since.trim() || undefined,
    tags: draft.tags,
  };
}

interface DivergenceEditorProps {
  draftStore?: RowDraftStore;
  projectId: string;
  divergence: AtlasDivergence;
  places: AtlasPlace[];
  onSave: (changes: Partial<AtlasDivergence>) => Promise<void>;
  onDelete: () => Promise<void>;
}

export default function DivergenceEditor({ projectId, divergence, places, onSave, onDelete, draftStore }: DivergenceEditorProps) {
  const { t } = useTranslation();
  const untitled = t('realAtlas.divergence.untitled');
  const { draft, patch, changes, dirty, acknowledge } = useRowDraft(divergence, toDraft, (d) => fromDraft(d, untitled), draftStore);

  return (
    <div className="space-y-5">
      <EditorHeader
        title={changes.title ?? ''}
        saveLabel={t('realAtlas.divergence.save')}
        canSave={dirty}
        onSave={async () => {
          await onSave(changes);
          acknowledge();
          toast.success(t('realAtlas.divergence.saved'));
        }}
        deleteLabel={t('realAtlas.divergence.delete')}
        deleteConfirm={t('realAtlas.divergence.deleteConfirm')}
        onDelete={onDelete}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('realAtlas.divergence.title')} className="sm:col-span-2">
          <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} className={inputClass} />
        </Field>
        <Field label={t('realAtlas.divergence.category')}>
          <select value={draft.category} onChange={(e) => patch({ category: e.target.value as DivergenceCategory })} className={selectClass}>
            {DIVERGENCE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`realAtlas.category.${c}`)}</option>)}
          </select>
        </Field>
        <Field label={t('realAtlas.divergence.place')}>
          <select value={draft.placeId} onChange={(e) => patch({ placeId: e.target.value })} className={selectClass}>
            <option value="">{t('realAtlas.divergence.noPlace')}</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={t('realAtlas.divergence.reality')}>
          <textarea rows={4} value={draft.reality} onChange={(e) => patch({ reality: e.target.value })} placeholder={t('realAtlas.divergence.realityPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.divergence.fiction')}>
          <textarea rows={4} value={draft.fiction} onChange={(e) => patch({ fiction: e.target.value })} placeholder={t('realAtlas.divergence.fictionPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.divergence.reason')} className="sm:col-span-2">
          <textarea rows={2} value={draft.reason} onChange={(e) => patch({ reason: e.target.value })} placeholder={t('realAtlas.divergence.reasonPlaceholder')} className={textareaClass} />
        </Field>
        <Field label={t('realAtlas.divergence.since')}>
          <input value={draft.since} onChange={(e) => patch({ since: e.target.value })} placeholder={t('realAtlas.divergence.sincePlaceholder')} className={inputClass} />
        </Field>
        <Field label={t('realAtlas.divergence.tags')}>
          <TagInput tags={draft.tags} onChange={(tags) => patch({ tags })} />
        </Field>
      </div>

      {/* The anchor adapter resolves divergence ids too, so backlinks and
          margin notes work here exactly as they do on a place. */}
      <div className="pt-2 border-t border-border">
        <AnnotationSurface projectId={projectId} engineId="real-atlas" entityId={divergence.id} layout="stack" />
      </div>
    </div>
  );
}
