import { useMemo } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useCodexEntries } from '@/hooks/useCodexEntries';
import { useInspirationImages } from '@/hooks/useGallery';
import CodexEntryList from '@/components/codex/CodexEntryList';

export default function CodexEngine({ projectId }: EngineComponentProps) {
  const { entries, loading: entriesLoading, addEntry, editEntry, removeEntry } = useCodexEntries(projectId);
  const { images, loading: imagesLoading } = useInspirationImages(projectId);

  const loading = useMemo(() => entriesLoading || imagesLoading, [entriesLoading, imagesLoading]);

  if (loading) return <EngineSpinner />;

  return (
    <CodexEntryList
      projectId={projectId}
      entries={entries}
      images={images}
      onAdd={addEntry}
      onEdit={editEntry}
      onDelete={removeEntry}
    />
  );
}
