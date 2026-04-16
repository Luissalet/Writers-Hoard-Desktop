import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useWritings } from '@/hooks/useWritings';
import WritingsView from '@/components/writings/WritingsView';

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
