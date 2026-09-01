import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useCodexEntries } from './hooks';
import CodexEntryList from '@/components/codex/CodexEntryList';

export default function CodexEngine({ projectId }: EngineComponentProps) {
  const { items: entries, loading, addItem: addEntry, editItem: editEntry, removeItem: removeEntry } = useCodexEntries(projectId);

  if (loading) return <EngineSpinner />;

  return (
    <CodexEntryList
      projectId={projectId}
      entries={entries}
      onAdd={addEntry}
      onEdit={editEntry}
      onDelete={removeEntry}
    />
  );
}
