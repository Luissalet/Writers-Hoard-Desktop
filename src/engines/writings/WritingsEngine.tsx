import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useWritings } from './hooks';
import WritingsView from './components/WritingsView';

export default function WritingsEngine({ projectId }: EngineComponentProps) {
  const { writings, loading, addWriting, editWriting, removeWriting, refresh } = useWritings(projectId);

  if (loading) return <EngineSpinner />;

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
