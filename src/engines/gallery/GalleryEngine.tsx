import { useMemo } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useInspirationImages, useImageCollections } from '@/hooks/useGallery';
import { useCodexEntries } from '@/hooks/useCodexEntries';
import InspirationGallery from '@/components/gallery/InspirationGallery';

export default function GalleryEngine({ projectId }: EngineComponentProps) {
  const { images, addImage, editImage, removeImage } = useInspirationImages(projectId);
  const { collections, addCollection, removeCollection } = useImageCollections(projectId);
  const { entries, loading: entriesLoading } = useCodexEntries(projectId);

  const loading = useMemo(() => entriesLoading, [entriesLoading]);

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
      onDeleteCollection={removeCollection}
    />
  );
}
