// ============================================================================
// One reference, edited — the visual bible
// ============================================================================
//
// Everything here works with no image model installed anywhere. The words that
// describe her, the dialect they are written in, the portrait the writer found
// on the internet, the turnarounds, the pose bank, the chapters she appears in:
// that is a character sheet a novelist can use on its own, and it is the state
// this engine has to be worth opening in. The generation parameters below it —
// hero seed, LoRA, preset — fill in later, on their own schedule.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Download, ImagePlus, Star, Trash2, Wand2, XCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { db } from '@/db';
import type { CodexEntry, InspirationImage } from '@/types';
import type { PromptDialect, VisualRef, VisualRefKind } from '@/types/visualRef';
import { generateId } from '@/utils/idGenerator';
import { stripHtml } from '@/utils/text';
import {
  findPlaceAppearances,
  useAppearanceWritings,
  type PlaceAppearance,
} from '@/engines/real-atlas/appearances';
import { makeThumbnail } from '../operations';
import {
  addControlImage,
  addToReferenceSet,
  clearHeroSeed,
  loadRefImages,
  removeControlImage,
  removeFromReferenceSet,
  setCanonicalImage,
} from '../refs';

const KINDS: readonly VisualRefKind[] = ['character', 'place', 'object', 'style'];
const DIALECTS: readonly PromptDialect[] = ['prose', 'tags'];

export interface ReferenceEditorProps {
  projectId: string;
  /** Named `visual`, never `ref`: `ref` is a reserved prop and React's
   *  compiler rules read every access to it as a ref read during render. */
  visual: VisualRef;
  entries: readonly CodexEntry[];
  onChange: (changes: Partial<VisualRef>) => void;
  onReload: () => void;
  onExportDataset: () => void;
}

export default function ReferenceEditor({
  projectId, visual, entries, onChange, onReload, onExportDataset,
}: ReferenceEditorProps) {
  const { t } = useTranslation();
  const [images, setImages] = useState<InspirationImage[]>([]);
  const [picking, setPicking] = useState(false);
  const [galleryRows, setGalleryRows] = useState<InspirationImage[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const reloadImages = useCallback(() => {
    void loadRefImages(visual).then(setImages);
  }, [visual]);
  useEffect(reloadImages, [reloadImages]);

  const byId = useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);
  const entry = visual.codexEntryId ? entries.find((row) => row.id === visual.codexEntryId) : undefined;

  // The chapters that name her. The one thing only a writing app can offer:
  // the picture and the prose it is supposed to match, side by side.
  const { items: writings } = useAppearanceWritings(projectId);
  const appearances: PlaceAppearance[] = useMemo(
    () => findPlaceAppearances([visual.name], writings),
    [visual.name, writings],
  );

  const uploadReference = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (!dataUrl) return;
    const row: InspirationImage = {
      id: generateId('img'),
      projectId,
      imageData: dataUrl,
      thumbnailData: await makeThumbnail(dataUrl),
      tags: ['reference', visual.name],
      notes: visual.name,
      linkedEntryIds: visual.codexEntryId ? [visual.codexEntryId] : [],
      createdAt: Date.now(),
      source: 'uploaded',
    };
    await db.inspirationImages.add(row);
    await addToReferenceSet(visual.id, row.id);
    onReload();
  };

  const openPicker = async () => {
    setGalleryRows(await db.inspirationImages.where('projectId').equals(projectId).limit(120).toArray());
    setPicking(true);
  };

  const thumb = (image: InspirationImage) => image.thumbnailData ?? image.imageData;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.editor.name')}</span>
          <input
            value={visual.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] text-text-primary outline-none focus:border-accent-gold"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.editor.kind')}</span>
          <select
            value={visual.kind}
            onChange={(event) => onChange({ kind: event.target.value as VisualRefKind })}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] text-text-primary outline-none focus:border-accent-gold"
          >
            {KINDS.map((kind) => <option key={kind} value={kind}>{t(`visualRef.kind.${kind}`)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.editor.codexEntry')}</span>
          <select
            value={visual.codexEntryId ?? ''}
            onChange={(event) => onChange({ codexEntryId: event.target.value || undefined })}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] text-text-primary outline-none focus:border-accent-gold"
          >
            <option value="">{t('visualRef.editor.codexNone')}</option>
            {entries.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
          </select>
        </label>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] text-text-muted">{t('visualRef.editor.dialect')}</span>
          {DIALECTS.map((dialect) => (
            <button
              key={dialect}
              type="button"
              onClick={() => onChange({ dialect })}
              className={`px-2 py-0.5 rounded text-[10px] border transition ${
                visual.dialect === dialect
                  ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold'
                  : 'border-border text-text-dim hover:text-text-primary'
              }`}
            >
              {t(`visualRef.dialect.${dialect}`)}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-text-dim">{t('visualRef.dialect.hint')}</p>
      </div>

      <label className="block">
        <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.editor.fragment')}</span>
        <textarea
          value={visual.promptFragment ?? ''}
          onChange={(event) => onChange({ promptFragment: event.target.value })}
          rows={3}
          placeholder={t(`visualRef.editor.fragmentPlaceholder.${visual.dialect}`)}
          className="w-full resize-y px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] text-text-primary outline-none focus:border-accent-gold"
        />
        {entry && !visual.promptFragment && (
          <button
            type="button"
            onClick={() => onChange({ promptFragment: stripHtml(entry.fields.physicalDescription ?? entry.content).slice(0, 400) })}
            className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent-gold hover:underline"
          >
            <Wand2 size={10} />
            {t('visualRef.editor.fromCodex')}
          </button>
        )}
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.editor.negative')}</span>
          <input
            value={visual.negativeFragment ?? ''}
            onChange={(event) => onChange({ negativeFragment: event.target.value })}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] text-text-primary outline-none focus:border-accent-gold"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.editor.trigger')}</span>
          <input
            value={visual.triggerWord ?? ''}
            onChange={(event) => onChange({ triggerWord: event.target.value })}
            placeholder={t('visualRef.editor.triggerPlaceholder')}
            className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] font-mono text-text-primary outline-none focus:border-accent-gold"
          />
          <span className="block text-[10px] text-text-dim mt-0.5">{t('visualRef.editor.triggerHint')}</span>
        </label>
      </div>

      {/* --- the reference set ------------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-primary font-medium">{t('visualRef.editor.references')}</span>
          <span className="text-[10px] text-text-dim">{visual.referenceImageIds.length}</span>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title={t('visualRef.editor.upload')}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-[10px] text-text-muted hover:text-accent-gold hover:border-accent-gold/40 transition"
          >
            <ImagePlus size={11} />
            {t('visualRef.editor.upload')}
          </button>
          <button
            type="button"
            onClick={() => void openPicker()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-[10px] text-text-muted hover:text-accent-gold hover:border-accent-gold/40 transition"
          >
            {t('visualRef.editor.fromGallery')}
          </button>
          <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(event) => void uploadReference(event)} />
        </div>
        <p className="text-[10px] text-text-dim">{t('visualRef.editor.referencesHint')}</p>
        {visual.referenceImageIds.length === 0 ? (
          <p className="text-[11px] text-text-dim">{t('visualRef.editor.referencesEmpty')}</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {visual.referenceImageIds.map((id) => {
              const image = byId.get(id);
              const isCanonical = visual.canonicalImageId === id;
              return (
                <div key={id} className={`group relative rounded-lg overflow-hidden border ${isCanonical ? 'border-accent-gold' : 'border-border'}`}>
                  {image ? (
                    <img src={thumb(image)} alt="" className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square bg-deep/50 flex items-center justify-center text-[9px] text-text-dim px-1 text-center">
                      {t('visualRef.editor.imageGone')}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 bg-deep/70 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={() => void setCanonicalImage(visual.id, id).then(onReload)}
                      title={t('visualRef.editor.canonical')}
                      className={`p-0.5 rounded ${isCanonical ? 'text-accent-gold' : 'text-text-dim hover:text-accent-gold'}`}
                    >
                      <Star size={11} fill={isCanonical ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void addControlImage(visual.id, id).then(onReload)}
                      title={t('visualRef.editor.pinPose')}
                      className="p-0.5 rounded text-text-dim hover:text-accent-gold"
                    >
                      <Wand2 size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeFromReferenceSet(visual.id, id).then(onReload)}
                      title={t('visualRef.editor.removeReference')}
                      className="ml-auto p-0.5 rounded text-text-dim hover:text-danger"
                    >
                      <XCircle size={11} />
                    </button>
                  </div>
                  {isCanonical && (
                    <span className="absolute top-0.5 left-0.5 px-1 rounded bg-accent-gold/90 text-deep text-[8px] font-semibold">
                      {t('visualRef.editor.canonicalBadge')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* --- the pose bank ------------------------------------------------ */}
      {(visual.controlImageIds?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] text-text-primary font-medium">{t('visualRef.editor.poses')}</span>
          <p className="text-[10px] text-text-dim">{t('visualRef.editor.posesHint')}</p>
          <div className="flex flex-wrap gap-2">
            {(visual.controlImageIds ?? []).map((id) => {
              const image = byId.get(id);
              return (
                <div key={id} className="relative w-14 h-14 rounded overflow-hidden border border-border">
                  {image && <img src={thumb(image)} alt="" className="w-full h-full object-cover" />}
                  <button
                    type="button"
                    onClick={() => void removeControlImage(visual.id, id).then(onReload)}
                    title={t('visualRef.editor.removePose')}
                    className="absolute top-0 right-0 p-0.5 bg-deep/70 text-text-dim hover:text-danger"
                  >
                    <XCircle size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --- what accumulates last ---------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/60 bg-elevated/40 p-2.5 space-y-1">
          <span className="text-[11px] text-text-primary font-medium">{t('visualRef.editor.heroSeed')}</span>
          {visual.heroSeed === undefined ? (
            <p className="text-[10px] text-text-dim">{t('visualRef.editor.heroSeedNone')}</p>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-accent-gold">#{visual.heroSeed}</span>
              <button
                type="button"
                onClick={() => void clearHeroSeed(visual.id).then(onReload)}
                title={t('visualRef.editor.clearHeroSeed')}
                className="p-1 rounded text-text-dim hover:text-danger transition"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border/60 bg-elevated/40 p-2.5 space-y-1">
          <span className="text-[11px] text-text-primary font-medium">{t('visualRef.editor.lora')}</span>
          {visual.lora ? (
            <p className="text-[10px] text-text-dim font-mono truncate">
              {visual.lora.fileName} · {visual.lora.weight.toFixed(2)} · {visual.lora.baseFamily}
            </p>
          ) : (
            <p className="text-[10px] text-text-dim">{t('visualRef.editor.loraNone')}</p>
          )}
          <button
            type="button"
            onClick={onExportDataset}
            disabled={visual.referenceImageIds.length === 0}
            title={visual.referenceImageIds.length === 0 ? t('visualRef.reason.noReferenceImages') : t('visualRef.editor.export')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-[10px] text-text-muted hover:text-accent-gold hover:border-accent-gold/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={11} />
            {t('visualRef.editor.export')}
          </button>
        </div>
      </div>

      {/* --- where does she appear? --------------------------------------- */}
      <div className="space-y-1">
        <span className="text-[11px] text-text-primary font-medium flex items-center gap-1.5">
          <BookOpen size={12} />
          {t('visualRef.editor.appearsIn')}
        </span>
        {appearances.length === 0 ? (
          <p className="text-[10px] text-text-dim">{t('visualRef.editor.appearsNowhere')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {appearances.map((appearance) => (
              <li key={appearance.writingId} className="px-2 py-0.5 rounded bg-elevated border border-border text-[10px] text-text-muted">
                {appearance.chapter !== undefined
                  ? `${t('visualRef.editor.chapterShort').replace('{n}', String(appearance.chapter))} · ${appearance.title}`
                  : appearance.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      {picking && (
        <div className="rounded-lg border border-border bg-elevated/60 p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-primary">{t('visualRef.editor.fromGallery')}</span>
            <button type="button" onClick={() => setPicking(false)} className="text-[10px] text-text-dim hover:text-text-primary">
              {t('common.cancel')}
            </button>
          </div>
          {galleryRows.length === 0 ? (
            <p className="text-[10px] text-text-dim">{t('visualRef.editor.galleryEmpty')}</p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 max-h-48 overflow-y-auto">
              {galleryRows.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => void addToReferenceSet(visual.id, image.id).then(() => { setPicking(false); onReload(); })}
                  className="rounded overflow-hidden border border-border hover:border-accent-gold transition"
                >
                  <img src={thumb(image)} alt="" className="w-full aspect-square object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
