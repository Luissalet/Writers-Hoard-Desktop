// ============================================
// AnnotationsSidebarBadge — orphan-count pill on the engine tab
// ============================================
//
// Tiny badge component that shows the number of orphaned annotations for
// the current project. Rendered by the Sidebar via the engine definition's
// `SidebarBadge` slot (see `EngineDefinition.SidebarBadge`).
//
// "Orphaned" = a text-range anchor whose fuzzy reanchor failed (the
// selected text or surrounding context no longer matches). Writers want
// to see this number at a glance so they can triage relinks.

import { useOrphanCount } from '../hooks';
import type { EngineComponentProps } from '@/engines/_types';

export default function AnnotationsSidebarBadge({ projectId }: EngineComponentProps) {
  const { count } = useOrphanCount(projectId);
  if (count <= 0) return null;

  return (
    <span
      className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold bg-danger/15 text-danger"
      title={`${count} orphaned annotation${count === 1 ? '' : 's'}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
