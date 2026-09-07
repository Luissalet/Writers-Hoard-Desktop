import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useWritings } from './hooks';
import WritingsView from './components/WritingsView';
import ReadErrorNotice from '@/components/common/ReadErrorNotice';

export default function WritingsEngine({ projectId }: EngineComponentProps) {
  const { writings, hasLoaded, loading, error, refetching, addWriting, editWriting, removeWriting, refresh } = useWritings(projectId);

  if (loading) return <EngineSpinner />;

  return (
    <>
      {error && <ReadErrorNotice onRetry={refresh} retrying={refetching} />}
      {hasLoaded && <WritingsView
        projectId={projectId}
        writings={writings}
        onAdd={addWriting}
        onEdit={editWriting}
        onDelete={removeWriting}
        onRefresh={refresh}
      />}
    </>
  );
}
