import { useMemo } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useCodexEntries } from './hooks';
import { useInspirationImages } from '@/engines/gallery/hooks';
import CodexEntryList from '@/components/codex/CodexEntryList';

export default function CodexEngine({ projectId }: EngineComponentProps) {
  const { items: entries, loading: entriesLoading, addItem: addEntry, editItem: editEntry, removeItem: removeEntry } = useCodexEntries(projectId);
  const { items: images, loading: imagesLoading } = useInspirationImages(projectId);

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
