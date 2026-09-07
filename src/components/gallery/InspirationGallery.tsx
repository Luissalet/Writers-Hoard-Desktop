import { useState, useRef, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Masonry from 'react-masonry-css';
import {
  Upload,
  Trash2,
  X,
  Image as ImageIcon,
  ZoomIn,
  FolderPlus,
  Folder,
  ChevronRight,
  Tag,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import type { InspirationImage, ImageCollection, CodexEntry } from '@/types';
import { generateId } from '@/utils/idGenerator';
import TagInput from '@/components/common/TagInput';
import EmptyState from '@/components/common/EmptyState';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import { useTranslation } from '@/i18n/useTranslation';
import { codexTypeIcons as typeIcons, codexTypeColors as typeColors } from '@/components/codex/codexTypeMeta';
import GalleryLightbox from './GalleryLightbox';
import { useImageHandoffStore } from '@/stores/imageHandoffStore';
import { navigateTo } from '@/engines/_shared/anchoring/navigation';
import { ConfirmDialog, useDeepLinkParam } from '@/engines/_shared';
import {
  BoundedImportQueue,
  DEFAULT_GALLERY_IMPORT_CONCURRENCY,
  type ImportQueueSnapshot,
  type ImportQueueWorkerContext,
} from './importQueue';
import { prepareGalleryImportFile } from './prepareImportFile';

const GALLERY_PAGE_SIZE = 60;

function foldReferenceText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

interface InspirationGalleryProps {
  projectId: string;
  images: InspirationImage[];
  collections: ImageCollection[];
  codexEntries?: CodexEntry[];
  onAdd: (image: InspirationImage) => Promise<void> | void;
  onEditImage: (id: string, changes: Partial<InspirationImage>) => void;
  onDelete: (id: string) => void;
  onAddCollection: (collection: ImageCollection) => Promise<void>;
  onDeleteCollection: (id: string) => void;
  /** Kept deliberately small by the queue (and clamped to four). */
  importConcurrency?: number;
}

interface GalleryImportInput {
  file: File;
  imageId: string;
  projectId: string;
  collectionId?: string;
  tags: string[];
  order: number;
}

interface CropRequest {
  id: string;
  label: string;
  imageSrc: string;
  order: number;
}

interface CropResult {
  cropped: string;
  original: string;
}

interface CropSettlement {
  confirm: (result: CropResult) => void;
}

type GalleryImportCopyKey =
  | 'title'
  | 'running'
  | 'paused'
  | 'complete'
  | 'progress'
  | 'failed'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'retry'
  | 'dismiss'
  | 'errorFallback';

export default function InspirationGallery({
  projectId,
  images,
  collections,
  codexEntries = [],
  onAdd,
  onEditImage,
  onDelete,
  onAddCollection,
  onDeleteCollection,
  importConcurrency = DEFAULT_GALLERY_IMPORT_CONCURRENCY,
}: InspirationGalleryProps) {
  const { t } = useTranslation();
  const [lightboxImage, setLightboxImage] = useState<InspirationImage | null>(null);
  const [filterTag, setFilterTag] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEntryId, setFilterEntryId] = useState<string>('');
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [showNewAlbum, setShowNewAlbum] = useState(false);
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [albumError, setAlbumError] = useState(false);
  const savingAlbumRef = useRef(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [entrySearchQuery, setEntrySearchQuery] = useState('');
  const [showEntryPicker, setShowEntryPicker] = useState(false);
  const linkedImageId = useDeepLinkParam('image');
  const linkedAlbumId = useDeepLinkParam('album');
  const [appliedLink, setAppliedLink] = useState('');
  const imageTarget = images.find(image => image.id === linkedImageId && image.projectId === projectId);
  const albumTarget = collections.find(album => album.id === linkedAlbumId && album.projectId === projectId);
  const linkKey = `${projectId}:${linkedImageId ?? ''}:${linkedAlbumId ?? ''}`;
  if (linkKey !== appliedLink && (imageTarget || albumTarget)) {
    setAppliedLink(linkKey);
    setFilterTag('');
    setSearchQuery('');
    setFilterEntryId('');
    setActiveCollectionId(imageTarget?.collectionId ?? albumTarget?.id ?? null);
    if (imageTarget) setLightboxImage(imageTarget);
  }
  const [cropRequests, setCropRequests] = useState<CropRequest[]>([]);
  // Deleting an image was a single unconfirmed click sitting on the thumbnail
  // hover bar — one slip and an irreplaceable reference photo was gone, while
  // deleting a whole album (recoverable, since images survive) did confirm.
  const [pendingDeleteImageId, setPendingDeleteImageId] = useState<string | null>(null);
  const [pendingDeleteCollectionId, setPendingDeleteCollectionId] = useState<string | null>(null);
  const entryPickerRef = useRef<HTMLDivElement>(null);
  const cropSettlementsRef = useRef(new Map<string, CropSettlement>());
  const nextImportOrderRef = useRef(0);
  const importMountedRef = useRef(true);

  const waitForCrop = useCallback((request: CropRequest, signal: AbortSignal): Promise<CropResult> => {
    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('Import cancelled', 'AbortError'));
    }

    return new Promise<CropResult>((resolve, reject) => {
      let settled = false;
      const removeRequest = () => {
        cropSettlementsRef.current.delete(request.id);
        signal.removeEventListener('abort', handleAbort);
        if (importMountedRef.current) {
          setCropRequests(current => current.filter(candidate => candidate.id !== request.id));
        }
      };
      const handleAbort = () => {
        if (settled) return;
        settled = true;
        removeRequest();
        reject(signal.reason ?? new DOMException('Import cancelled', 'AbortError'));
      };
      const confirm = (result: CropResult) => {
        if (settled) return;
        settled = true;
        removeRequest();
        resolve(result);
      };

      cropSettlementsRef.current.set(request.id, { confirm });
      signal.addEventListener('abort', handleAbort, { once: true });
      setCropRequests(current => [...current, request].sort((a, b) => a.order - b.order));
      // Abort can race the first check and listener registration.
      if (signal.aborted) handleAbort();
    });
  }, []);

  const processImport = useCallback(async (
    input: GalleryImportInput,
    context: ImportQueueWorkerContext,
  ) => {
    const imageSrc = await prepareGalleryImportFile(input.file, context.signal);
    const crop = await waitForCrop({
      id: context.id,
      label: context.label,
      imageSrc,
      order: input.order,
    }, context.signal);
    if (context.signal.aborted) {
      throw context.signal.reason ?? new DOMException('Import cancelled', 'AbortError');
    }

    await onAdd({
      id: input.imageId,
      projectId: input.projectId,
      collectionId: input.collectionId,
      imageData: crop.cropped,
      imageDataOriginal: crop.original,
      tags: input.tags,
      notes: '',
      createdAt: Date.now(),
    });
  }, [onAdd, waitForCrop]);

  const [importQueue] = useState(() => new BoundedImportQueue<GalleryImportInput>({
    concurrency: importConcurrency,
    // Raw browser/Dexie messages are inconsistent and often untranslated. The
    // status row names the file and offers retry; use one localised explanation.
    errorMessage: () => '',
  }));
  const [importSnapshot, setImportSnapshot] = useState<ImportQueueSnapshot>(
    () => importQueue.getSnapshot(),
  );

  useEffect(() => importQueue.subscribe(setImportSnapshot), [importQueue]);

  useEffect(() => importQueue.setConcurrency(importConcurrency), [importConcurrency, importQueue]);

  useEffect(() => {
    const settlements = cropSettlementsRef.current;
    importMountedRef.current = true;
    return () => {
      importMountedRef.current = false;
      importQueue.cancelPending();
      settlements.clear();
    };
  }, [importQueue]);

  // Plain function — the React compiler memoizes it; a manual useCallback
  // here made it bail out on the whole component.
  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const current = importQueue.getSnapshot();
    if (current.idle && current.total > 0 && current.failed === 0) {
      importQueue.clearSettled();
    }

    importQueue.enqueue(acceptedFiles.map(file => ({
      id: generateId('gallery-import'),
      label: file.name,
      input: {
        file,
        imageId: generateId('img'),
        projectId,
        collectionId: activeCollectionId || undefined,
        tags: [...uploadTags],
        order: nextImportOrderRef.current++,
      },
    })), processImport);
  };

  const { getRootProps, getInputProps, isDragActive, open: openFilePicker } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] },
  });

  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim() || savingAlbumRef.current) return;
    savingAlbumRef.current = true;
    setSavingAlbum(true);
    setAlbumError(false);
    try {
      await onAddCollection({
      id: generateId('col'),
      projectId,
      title: newAlbumName.trim(),
      createdAt: Date.now(),
      });
      setNewAlbumName('');
      setShowNewAlbum(false);
    } catch {
      setAlbumError(true);
    } finally {
      savingAlbumRef.current = false;
      setSavingAlbum(false);
    }
  };

  const handleMoveToAlbum = (imageId: string, collectionId: string | null) => {
    onEditImage(imageId, { collectionId: collectionId || undefined });
  };

  // Close entry picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (entryPickerRef.current && !entryPickerRef.current.contains(e.target as Node)) {
        setShowEntryPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleToggleEntryLink = (imageId: string, entryId: string) => {
    const image = images.find(img => img.id === imageId);
    if (!image) return;
    const current = image.linkedEntryIds || [];
    const updated = current.includes(entryId)
      ? current.filter(id => id !== entryId)
      : [...current, entryId];
    onEditImage(imageId, { linkedEntryIds: updated });
  };

  // One lookup table for the whole grid. Resolving each image's badges with a
  // linear filter over the codex cost one full pass per image, on every render
  // — including every keystroke in the entry picker's search box.
  const entryById = new Map(codexEntries.map(entry => [entry.id, entry]));

  const getLinkedEntries = (image: InspirationImage): CodexEntry[] =>
    [...new Set(image.linkedEntryIds || [])]
      .map(id => entryById.get(id))
      .filter((entry): entry is CodexEntry => Boolean(entry));

  // Filter images
  const allTags = [...new Set(images.flatMap(img => img.tags))];
  const filteredByCollection = activeCollectionId
    ? images.filter(img => img.collectionId === activeCollectionId)
    : images;
  const filteredByTag = filterTag
    ? filteredByCollection.filter(img => img.tags.includes(filterTag))
    : filteredByCollection;
  const filteredByEntry = filterEntryId
    ? filteredByTag.filter(img => (img.linkedEntryIds || []).includes(filterEntryId))
    : filteredByTag;
  const searchTerms = foldReferenceText(searchQuery).trim().split(/\s+/).filter(Boolean);
  const filtered = searchTerms.length ? filteredByEntry.filter(img => {
    const text = foldReferenceText([img.notes, ...img.tags, ...getLinkedEntries(img).map(entry => entry.title)].join(' '));
    return searchTerms.every(term => text.includes(term));
  }) : filteredByEntry;
  const hasFilters = Boolean(searchQuery || filterTag || filterEntryId);
  const clearFilters = () => { setSearchQuery(''); setFilterTag(''); setFilterEntryId(''); };

  // A mood board of a few thousand references used to mount every one of them
  // at once, decoding a full-size base64 payload per tile. The grid now grows a
  // page at a time; changing album, tag or entry starts again from the first
  // page (render-adjust, the same pattern the deep link in CodexEntryList uses).
  const filterKey = `${activeCollectionId ?? ''}\u0000${filterTag}\u0000${filterEntryId}\u0000${searchQuery}`;
  const [appliedFilterKey, setAppliedFilterKey] = useState(filterKey);
  const [visibleCount, setVisibleCount] = useState(GALLERY_PAGE_SIZE);
  if (filterKey !== appliedFilterKey) {
    setAppliedFilterKey(filterKey);
    setVisibleCount(GALLERY_PAGE_SIZE);
  }
  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;

  // Entries that have linked images (for filter)
  const linkedEntryIds = new Set(images.flatMap(img => img.linkedEntryIds || []));
  const linkedEntries = codexEntries.filter(e => linkedEntryIds.has(e.id));

  // Filtered entries for picker
  const filteredPickerEntries = entrySearchQuery
    ? codexEntries.filter(e => e.title.toLowerCase().includes(entrySearchQuery.toLowerCase()))
    : codexEntries;

  const breakpoints = { default: 4, 1100: 3, 700: 2, 500: 1 };
  const activeCrop = cropRequests[0];
  const failedImports = importSnapshot.items.filter(item => item.state === 'failed');
  const importPending = importSnapshot.queued + importSnapshot.running > 0;
  const importText = (
    key: GalleryImportCopyKey,
    values: Record<string, string | number> = {},
  ) => Object.entries(values).reduce(
    (copy, [name, value]) => copy.replaceAll(`{${name}}`, String(value)),
    t(`gallery.import.${key}`),
  );
  const importStatus = importSnapshot.paused && importSnapshot.queued > 0
    ? importText('paused')
    : importSnapshot.idle
      ? importText('complete')
      : importText('running');

  return (
    <div className="space-y-4">
      {/* Album tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveCollectionId(null)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
            !activeCollectionId
              ? 'bg-accent-gold/15 text-accent-gold font-semibold'
              : 'text-text-muted hover:text-text-primary hover:bg-elevated'
          }`}
        >
          <ImageIcon size={14} />
          {t('gallery.allImages')}
          <span className="text-xs opacity-60 ml-1">({images.length})</span>
        </button>

        {collections.map(col => {
          const count = images.filter(img => img.collectionId === col.id).length;
          return (
            <div key={col.id} className="flex items-center group">
              <button
                onClick={() => setActiveCollectionId(col.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
                  activeCollectionId === col.id
                    ? 'bg-accent-plum/15 text-accent-plum-light font-semibold'
                    : 'text-text-muted hover:text-text-primary hover:bg-elevated'
                }`}
              >
                <Folder size={14} />
                {col.title}
                <span className="text-xs opacity-60 ml-1">({count})</span>
              </button>
              <button
                onClick={() => setPendingDeleteCollectionId(col.id)}
                className="p-1 text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger transition"
                title={t('gallery.deleteAlbum')}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {showNewAlbum ? (
          <fieldset disabled={savingAlbum} aria-busy={savingAlbum} className="flex items-center gap-1">
            <input
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder={t('gallery.albumName')}
              className="px-2 py-1 bg-elevated border border-border rounded text-sm text-text-primary outline-none focus:border-accent-gold w-32"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateAlbum(); if (e.key === 'Escape' && !savingAlbum) setShowNewAlbum(false); }}
            />
            <button onClick={handleCreateAlbum} className="p-1 text-accent-gold hover:text-accent-amber transition" title={t('common.create')} aria-label={t('common.create')}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button onClick={() => setShowNewAlbum(false)} className="p-1 text-text-muted hover:text-text-primary transition" title={t('common.cancel')} aria-label={t('common.cancel')}>
              <X size={14} aria-hidden="true" />
            </button>
          </fieldset>
        ) : (
          <button
            onClick={() => setShowNewAlbum(true)}
            className="flex items-center gap-1 px-2 py-1.5 text-text-muted hover:text-accent-gold transition text-sm"
          >
            <FolderPlus size={14} />
            {t('gallery.newAlbum')}
          </button>
        )}
      </div>

      {albumError && <p role="alert" className="text-sm text-red-400">{t('gallery.albumSaveError')}</p>}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} aria-label={t('gallery.searchReferences')} placeholder={t('gallery.searchReferences')} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
        {hasFilters && <button type="button" onClick={clearFilters} className="px-3 py-2 text-sm text-accent-gold hover:underline">{t('common.resetFilters')}</button>}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div {...getRootProps()} className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition border-2 border-dashed ${
          isDragActive ? 'border-accent-gold bg-accent-gold/10 text-accent-gold' : 'border-border text-text-muted hover:border-accent-gold/50 hover:text-text-primary'
        }`}>
          <input {...getInputProps()} />
          <Upload size={16} />
          <span className="text-sm">{isDragActive ? t('gallery.dropImages') : t('gallery.uploadImages')}</span>
        </div>

        {allTags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => { setFilterTag(''); setFilterEntryId(''); }}
              className={`px-2.5 py-1 rounded text-xs transition ${!filterTag && !filterEntryId ? 'bg-accent-gold/20 text-accent-gold' : 'text-text-muted hover:text-text-primary'}`}
            >
              {t('common.all')}
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => { setFilterTag(tag); setFilterEntryId(''); }}
                className={`px-2.5 py-1 rounded text-xs transition ${filterTag === tag ? 'bg-accent-plum/20 text-accent-plum-light' : 'text-text-muted hover:text-text-primary'}`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Codex entry filter */}
        {linkedEntries.length > 0 && (
          <div className="flex gap-1 flex-wrap items-center">
            <Tag size={12} className="text-text-dim mr-1" />
            {linkedEntries.map(entry => {
              const Icon = typeIcons[entry.type];
              const color = typeColors[entry.type];
              return (
                <button
                  key={entry.id}
                  onClick={() => { setFilterEntryId(filterEntryId === entry.id ? '' : entry.id); setFilterTag(''); }}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition ${
                    filterEntryId === entry.id
                      ? 'font-semibold'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                  style={filterEntryId === entry.id ? { backgroundColor: `${color}20`, color } : {}}
                >
                  <Icon size={10} />
                  {entry.title}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload tags */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">{t('gallery.tagsForUploads')}</span>
        <div className="flex-1">
          <TagInput tags={uploadTags} onChange={setUploadTags} placeholder={t('gallery.tagPlaceholder')} />
        </div>
      </div>

      {importSnapshot.total > 0 && (
        <section
          className="space-y-2 rounded-xl border border-border bg-elevated/70 p-3"
          aria-labelledby="gallery-import-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 id="gallery-import-title" className="text-sm font-semibold text-text-primary">
                  {importText('title')}
                </h2>
                {failedImports.length > 0 && (
                  <span className="text-xs font-medium text-danger">
                    {importText('failed', { count: failedImports.length })}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-muted" role="status" aria-live="polite">
                {importStatus}.{' '}
                {importText('progress', {
                  processed: importSnapshot.processed,
                  total: importSnapshot.total,
                })}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {importSnapshot.queued > 0 && (
                <button
                  type="button"
                  onClick={() => importSnapshot.paused ? importQueue.resume() : importQueue.pause()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-surface hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold"
                >
                  {importSnapshot.paused
                    ? <Play size={13} aria-hidden="true" />
                    : <Pause size={13} aria-hidden="true" />}
                  {importSnapshot.paused ? importText('resume') : importText('pause')}
                </button>
              )}
              {importPending && (
                <button
                  type="button"
                  onClick={() => importQueue.cancelPending()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                >
                  <X size={13} aria-hidden="true" />
                  {importText('cancel')}
                </button>
              )}
              {importSnapshot.idle && (
                <button
                  type="button"
                  onClick={() => importQueue.clearSettled()}
                  className="rounded-lg p-1.5 text-text-muted hover:bg-surface hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold"
                  title={importText('dismiss')}
                  aria-label={importText('dismiss')}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <progress
            className="block h-1.5 w-full accent-accent-gold"
            max={Math.max(1, importSnapshot.total)}
            value={importSnapshot.processed}
            aria-label={importText('progress', {
              processed: importSnapshot.processed,
              total: importSnapshot.total,
            })}
          />

          {failedImports.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-y-auto" aria-live="polite">
              {failedImports.map(item => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger/8 px-2.5 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text-primary" title={item.label}>
                      {item.label}
                    </span>
                    <span className="text-text-muted">{item.error || importText('errorFallback')}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => importQueue.retry(item.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium text-accent-gold hover:bg-accent-gold/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold"
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    {importText('retry', { name: item.label })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Gallery */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={40} />}
          title={hasFilters ? t('common.filteredEmpty') : activeCollectionId ? t('gallery.albumEmpty.title') : t('gallery.empty.title')}
          message={hasFilters ? t('gallery.searchReferences') : activeCollectionId ? t('gallery.albumEmpty.message') : t('gallery.empty.message')}
          action={hasFilters ? { label: t('common.resetFilters'), onClick: clearFilters } : { label: t('gallery.uploadImages'), onClick: openFilePicker }}
        />
      ) : (
        <Masonry
          breakpointCols={breakpoints}
          className="flex gap-3 w-auto"
          columnClassName="flex flex-col gap-3"
        >
          {visible.map(image => {
            const imageLinkedEntries = getLinkedEntries(image);
            return (
              <div key={image.id} className="group relative rounded-lg overflow-hidden border border-border hover:border-accent-gold/40 transition">
                <img
                  src={image.thumbnailData ?? image.imageData}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full block cursor-pointer"
                  onClick={() => setLightboxImage(image)}
                />
                {/* Linked entry badges (always visible) */}
                {imageLinkedEntries.length > 0 && (
                  <div className="absolute top-1.5 left-1.5 flex gap-1 flex-wrap max-w-[calc(100%-3rem)]">
                    {imageLinkedEntries.map(entry => {
                      const Icon = typeIcons[entry.type];
                      const color = typeColors[entry.type];
                      return (
                        <span
                          key={entry.id}
                          className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-sm"
                          style={{ backgroundColor: `${color}cc`, color: '#fff' }}
                        >
                          <Icon size={8} />
                          {entry.title}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition">
                  <div className="absolute bottom-0 left-0 right-0 p-2 flex items-end justify-between">
                    <div className="flex gap-1 flex-wrap">
                      {image.tags.map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-black/50 rounded text-white/80">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      {/* Tag with codex entry */}
                      {codexEntries.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingImageId(editingImageId === image.id ? null : image.id);
                            setEntrySearchQuery('');
                            setShowEntryPicker(true);
                          }}
                          className="p-1.5 bg-black/50 rounded hover:bg-accent-plum/70 transition"
                          title={t('gallery.linkEntries')}
                        >
                          <Tag size={14} className="text-white" />
                        </button>
                      )}
                      {/* Move to album dropdown */}
                      {collections.length > 0 && (
                        <select
                          value={image.collectionId || ''}
                          onChange={(e) => handleMoveToAlbum(image.id, e.target.value || null)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] bg-black/50 text-white/80 rounded px-1 py-0.5 outline-none border-0 max-w-[80px]"
                          title={t('gallery.moveToAlbum')}
                        >
                          <option value="">{t('gallery.noAlbum')}</option>
                          {collections.map(col => (
                            <option key={col.id} value={col.id}>{col.title}</option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={() => setLightboxImage(image)}
                        className="p-1.5 bg-black/50 rounded hover:bg-black/70 transition"
                        title={t('common.open')}
                        aria-label={t('common.open')}
                      >
                        <ZoomIn size={14} className="text-white" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => setPendingDeleteImageId(image.id)}
                        title={t('common.delete')}
                        className="p-1.5 bg-black/50 rounded hover:bg-danger/70 transition"
                      >
                        <Trash2 size={14} className="text-white" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Entry picker dropdown */}
                {editingImageId === image.id && showEntryPicker && (
                  <div
                    ref={entryPickerRef}
                    className="absolute bottom-0 left-0 right-0 z-20 bg-deep border border-border rounded-t-xl shadow-xl max-h-[60%] overflow-hidden flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-2 border-b border-border flex items-center gap-2">
                      <input
                        value={entrySearchQuery}
                        onChange={(e) => setEntrySearchQuery(e.target.value)}
                        placeholder={t('codex.searchEntries')}
                        className="flex-1 px-2 py-1 bg-elevated border border-border rounded text-xs text-text-primary outline-none focus:border-accent-gold"
                        autoFocus
                      />
                      <button
                        onClick={() => { setEditingImageId(null); setShowEntryPicker(false); }}
                        className="p-1 text-text-muted hover:text-text-primary"
                        title={t('common.close')}
                        aria-label={t('common.close')}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="overflow-y-auto p-1">
                      {filteredPickerEntries.map(entry => {
                        const Icon = typeIcons[entry.type];
                        const color = typeColors[entry.type];
                        const isLinked = (image.linkedEntryIds || []).includes(entry.id);
                        return (
                          <button
                            key={entry.id}
                            onClick={() => handleToggleEntryLink(image.id, entry.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition ${
                              isLinked ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-muted hover:bg-elevated hover:text-text-primary'
                            }`}
                          >
                            <Icon size={12} style={{ color }} />
                            <span className="truncate flex-1">{entry.title}</span>
                            {isLinked && <span className="text-[10px] text-accent-gold">&#10003;</span>}
                          </button>
                        );
                      })}
                      {filteredPickerEntries.length === 0 && (
                        <p className="text-[10px] text-text-dim text-center py-2">{t('gallery.noEntriesFound')}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Masonry>
      )}

      {remaining > 0 && (
        <div className="flex justify-center">
          <button
            onClick={() => setVisibleCount(count => count + GALLERY_PAGE_SIZE)}
            className="px-4 py-2 rounded-lg border border-border text-sm text-text-muted hover:border-accent-gold hover:text-text-primary transition"
          >
            {t('gallery.showMore').replace('{count}', String(remaining))}
          </button>
        </div>
      )}

      {/* Lightbox. The image is re-resolved from `images` so a caption saved
          from inside the lightbox is reflected on the next open — the state
          only remembers WHICH image is open, not its frozen row. */}
      {lightboxImage && (() => {
        const currentImage = images.find((i) => i.id === lightboxImage.id) ?? lightboxImage;
        return (
          <GalleryLightbox
            image={currentImage}
            linkedEntries={getLinkedEntries(currentImage)}
            onClose={() => setLightboxImage(null)}
            onEditNotes={(notes) => onEditImage(currentImage.id, { notes })}
            onUseAsReference={() => {
              // The studio drains the hand-off on arrival and shows the image
              // in its reference slot; the prompt stays whatever it was.
              useImageHandoffStore.getState().request({
                prompt: '',
                autoGenerate: false,
                initImage: currentImage.imageDataOriginal ?? currentImage.imageData,
              });
              setLightboxImage(null);
              navigateTo(`/project/${encodeURIComponent(projectId)}/image-studio`);
            }}
          />
        );
      })()}

      {/* Keyed by the file being cropped. ImagePreviewCrop seeds crop, zoom and
          rotation in state and only resets `crop` on image load, so dropping
          several photos at once carried the first one's crop rectangle (in
          displayed pixels) and rotation onto the second and third — producing
          off-centre crops or blank canvases. Remounting per file resets it. */}
      {activeCrop && (
        <ImagePreviewCrop
          key={activeCrop.id}
          imageSrc={activeCrop.imageSrc}
          onConfirm={(cropped, original) => cropSettlementsRef.current
            .get(activeCrop.id)
            ?.confirm({ cropped, original })}
          onCancel={() => importQueue.cancelTask(activeCrop.id)}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteImageId !== null}
        destructive
        message={t('gallery.deleteImageConfirm')}
        onConfirm={() => {
          if (pendingDeleteImageId) onDelete(pendingDeleteImageId);
          setPendingDeleteImageId(null);
        }}
        onCancel={() => setPendingDeleteImageId(null)}
      />

      <ConfirmDialog
        open={pendingDeleteCollectionId !== null}
        destructive
        message={
          pendingDeleteCollectionId
            ? t('gallery.deleteAlbumConfirm').replace(
                '{name}',
                collections.find((c) => c.id === pendingDeleteCollectionId)?.title ?? '',
              )
            : ''
        }
        onConfirm={() => {
          if (!pendingDeleteCollectionId) return;
          const id = pendingDeleteCollectionId;
          setPendingDeleteCollectionId(null);
          // The delete unfiles the album's images itself, in one transaction.
          onDeleteCollection(id);
          if (activeCollectionId === id) setActiveCollectionId(null);
        }}
        onCancel={() => setPendingDeleteCollectionId(null)}
      />
    </div>
  );
}
