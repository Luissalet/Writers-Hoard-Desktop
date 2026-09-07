import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useCodexEntries } from './hooks';
import CodexEntryList from '@/components/codex/CodexEntryList';
import { saveCodexDraft } from './operations';
import type { CodexEntry } from '@/types';

export default function CodexEngine({ projectId }: EngineComponentProps) {
  const { items: entries, loading, refresh, addItem: addEntry, editItem: editEntry, removeItem: removeEntry } = useCodexEntries(projectId);

  if (loading) return <EngineSpinner />;

  return (
    <CodexEntryList
      key={projectId}
      projectId={projectId}
      entries={entries}
      onAdd={addEntry}
      onEdit={async (id, changes, base) => {
        if (base) {
          await saveCodexDraft(base, changes as CodexEntry);
          await refresh();
        } else await editEntry(id, changes);
      }}
      onDelete={removeEntry}
    />
  );
}
