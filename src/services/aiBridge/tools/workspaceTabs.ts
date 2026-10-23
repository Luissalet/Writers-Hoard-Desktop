// ============================================
// AI bridge — the companion tabs (read only)
// ============================================
// The workspace writes its tab layout to this window's storage on every change
// (components/project/workspace/workspaceTabs.ts), so reading it back is the
// same answer the tab strip shows. Nothing is opened, closed or renamed here.

import { db } from '@/db';
import { loadTabsState, summarizeTabs } from '@/components/project/workspace/workspaceTabs';
import { BridgeError, resolveProjectId, type ToolArgs } from './shared';

export async function whWorkspaceTabs(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', 'Project not found.');
  const state = loadTabsState(projectId, project.enabledEngines ?? []);
  return { projectId, tabs: summarizeTabs(state), activeTabId: state.activeId || null, reopenableClosedTabs: state.closed.length, tabLimit: 4 };
}
