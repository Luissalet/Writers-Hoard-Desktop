import { useWorkspacePaneFocus } from '@/components/project/workspace/useWorkspacePaneFocus';

export function useTableWorkspaceFocus(projectId: string, eraId: string | undefined, documentId: string | undefined) {
  return useWorkspacePaneFocus({ projectId, eraId, namespace: 'tables', documentId }, !!documentId);
}
