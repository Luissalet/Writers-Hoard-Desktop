import { useMemo } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useInspirationImages, useImageCollections } from './hooks';
import { useCodexEntries } from '@/engines/codex/hooks';
import InspirationGallery from '@/components/gallery/InspirationGallery';

export default function GalleryEngine({ projectId }: EngineComponentProps) {
  const { items: images, addItem: addImage, editItem: editImage, removeItem: removeImage, refresh: refreshImages } = useInspirationImages(projectId);
  const { items: collections, addItem: addCollection, removeItem: removeCollection } = useImageCollections(projectId);
  const { items: entries, loading: entriesLoading } = useCodexEntries(projectId);

  const loading = useMemo(() => entriesLoading, [entriesLoading]);

  // Deleting an album unfiles its images in the same transaction, so the grid
  // has to re-read them — its own hook never saw that write.
  const deleteCollection = async (id: string) => {
    await removeCollection(id);
    await refreshImages();
  };

  if (loading) return <EngineSpinner />;

  return (
    <InspirationGallery
      projectId={projectId}
      images={images}
      collections={collections}
      codexEntries={entries}
      onAdd={addImage}
      onEditImage={editImage}
      onDelete={removeImage}
      onAddCollection={addCollection}
      onDeleteCollection={deleteCollection}
    />
  );
}
