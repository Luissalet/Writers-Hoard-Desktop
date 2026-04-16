import type { EngineComponentProps } from '@/engines/_types';
import { useWritings } from './hooks';
import WritingsView from './components/WritingsView';

export default function WritingsEngine({ projectId }: EngineComponentProps) {
  const { writings, loading, addWriting, editWriting, removeWriting, refresh } = useWritings(projectId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <WritingsView
      projectId={projectId}
      writings={writings}
      onAdd={addWriting}
      onEdit={editWriting}
      onDelete={removeWriting}
      onRefresh={refresh}
    />
  );
}
