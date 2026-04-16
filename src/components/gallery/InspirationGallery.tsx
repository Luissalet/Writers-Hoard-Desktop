import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Masonry from 'react-masonry-css';
import { Upload, Trash2, X, Image as ImageIcon, ZoomIn, FolderPlus, Folder, ChevronRight, Tag, User, MapPin, Sword, Shield, Sparkles, HelpCircle } from 'lucide-react';
import type { InspirationImage, ImageCollection, CodexEntry, CodexEntryType } from '@/types';
import { generateId } from '@/utils/idGenerator';
import TagInput from '@/components/common/TagInput';
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';

const typeIcons: Record<CodexEntryType, typeof User> = {
  character: User,
  location: MapPin,
  item: Sword,
  faction: Shield,
  concept: Sparkles,
  magic: Sparkles,
  custom: HelpCircle,
};

const typeColors: Record<CodexEntryType, string> = {
  character: '#c4973b',
  location: '#4a9e6d',
  item: '#4a7ec4',
  faction: '#c4463a',
  concept: '#7c5cbf',
  magic: '#d4a843',
  custom: '#8a8690',
};

interface InspirationGalleryProps {
  projectId: string;
  images: InspirationImage[];
  collections: ImageCollection[];
  codexEntries?: CodexEntry[];
  onAdd: (image: InspirationImage) => void;
  onEditImage: (id: string, changes: Partial<InspirationImage>) => void;
  onDelete: (id: string) => void;
  onAddCollection: (collection: ImageCollection) => void;
  onDeleteCollection: (id: string) => void;
}

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
}: InspirationGalleryProps) {
  const { t } = useTranslation();
  const [lightboxImage, setLightboxImage] = useState<InspirationImage | null>(null);
  const [filterTag, setFilterTag] = useState<string>('');
  const [filterEntryId, setFilterEntryId] = useState<string>('');
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [showNewAlbum, setShowNewAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [entrySearchQuery, setEntrySearchQuery] = useState('');
  const [showEntryPicker, setShowEntryPicker] = useState(false);
  const entryPickerRef = useRef<HTMLDivElement>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = e.target?.result as string;
        onAdd({
          id: generateId('img'),
          projectId,
          collectionId: activeCollectionId || undefined,
          imageData,
          tags: [...uploadTags],
          notes: '',
          createdAt: Date.now(),
        });
      };
      reader.readAsDataURL(file);
    });
  }, [projectId, onAdd, uploadTags, activeCollectionId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] },
  });

  const handleCreateAlbum = () => {
    if (!newAlbumName.trim()) return;
    onAddCollection({
      id: generateId('col'),
      projectId,
      title: newAlbumName.trim(),
      createdAt: Date.now(),
    });
    setNewAlbumName('');
    setShowNewAlbum(false);
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

  const getLinkedEntries = (image: InspirationImage): CodexEntry[] => {
    const ids = image.linkedEntryIds || [];
    return codexEntries.filter(e => ids.includes(e.id));
  };

  // Filter images
  const allTags = [...new Set(images.flatMap(img => img.tags))];
  const filteredByCollection = activeCollectionId
    ? images.filter(img => img.collectionId === activeCollectionId)
    : images;
  const filteredByTag = filterTag
    ? filteredByCollection.filter(img => img.tags.includes(filterTag))
    : filteredByCollection;
  const filtered = filterEntryId
    ? filteredByTag.filter(img => (img.linkedEntryIds || []).includes(filterEntryId))
    : filteredByTag;

  // Entries that have linked images (for filter)
  const linkedEntryIds = [...new Set(images.flatMap(img => img.linkedEntryIds || []))];
  const linkedEntries = codexEntries.filter(e => linkedEntryIds.includes(e.id));

  // Filtered entries for picker
  const filteredPickerEntries = entrySearchQuery
    ? codexEntries.filter(e => e.title.toLowerCase().includes(entrySearchQuery.toLowerCase()))
    : codexEntries;

  const breakpoints = { default: 4, 1100: 3, 700: 2, 500: 1 };

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
                onClick={() => {
                  if (confirm(t('gallery.deleteAlbumConfirm').replace('{name}', col.title))) {
                    // Move images to no collection before deleting
                    images.filter(img => img.collectionId === col.id).forEach(img => {
                      onEditImage(img.id, { collectionId: undefined });
                    });
                    onDeleteCollection(col.id);
                    if (activeCollectionId === col.id) setActiveCollectionId(null);
                  }
                }}
                className="p-1 text-text-dim opacity-0 group-hover:opacity-100 hover:text-danger transition"
                title={t('gallery.deleteAlbum')}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {showNewAlbum ? (
          <div className="flex items-center gap-1">
            <input
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder={t('gallery.albumName')}
              className="px-2 py-1 bg-elevated border border-border rounded text-sm text-text-primary outline-none focus:border-accent-gold w-32"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAlbum(); if (e.key === 'Escape') setShowNewAlbum(false); }}
            />
            <button onClick={handleCreateAlbum} className="p-1 text-accent-gold hover:text-accent-amber transition">
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setShowNewAlbum(false)} className="p-1 text-text-muted hover:text-text-primary transition">
              <X size={14} />
            </button>
          </div>
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

      {/* Controls */}
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

      {/* Gallery */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<ImageIcon size={40} />}
          title={activeCollectionId ? t('gallery.albumEmpty.title') : t('gallery.empty.title')}
          message={activeCollectionId ? t('gallery.albumEmpty.message') : t('gallery.empty.message')}
          action={{ label: t('gallery.uploadImages'), onClick: () => {} }}
        />
      ) : (
        <Masonry
          breakpointCols={breakpoints}
          className="flex gap-3 w-auto"
          columnClassName="flex flex-col gap-3"
        >
          {filtered.map(image => {
            const imageLinkedEntries = getLinkedEntries(image);
            return (
              <div key={image.id} className="group relative rounded-lg overflow-hidden border border-border hover:border-accent-gold/40 transition">
                <img
                  src={image.imageData}
                  alt=""
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
                      >
                        <ZoomIn size={14} className="text-white" />
                      </button>
                      <button
                        onClick={() => onDelete(image.id)}
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
                      >
                        <X size={12} />
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

      {/* Lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <button className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition">
            <X size={24} className="text-white" />
          </button>
          <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightboxImage.imageData}
              alt=""
              className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl"
            />
            {/* Linked entries in lightbox */}
            {getLinkedEntries(lightboxImage).length > 0 && (
              <div className="flex gap-2 flex-wrap justify-center">
                {getLinkedEntries(lightboxImage).map(entry => {
                  const Icon = typeIcons[entry.type];
                  const color = typeColors[entry.type];
                  return (
                    <span
                      key={entry.id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                      style={{ backgroundColor: `${color}30`, color }}
                    >
                      <Icon size={12} />
                      {entry.title}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
