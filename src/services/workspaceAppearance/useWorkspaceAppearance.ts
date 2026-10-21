import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { appearanceFromProject } from './store';
import { workspaceAppearanceStyle } from './style';
import type { AppearanceScope } from './types';
export function useWorkspaceAppearance(scope: AppearanceScope) {
  const project = useLiveQuery(() => db.projects.get(scope.projectId), [scope.projectId]);
  const appearance = project ? appearanceFromProject(project, scope) : undefined;
  return { appearance, style: workspaceAppearanceStyle(appearance?.effective ?? {}) };
}
