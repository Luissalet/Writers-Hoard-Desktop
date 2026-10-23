import { db } from '@/db';
import { deriveNextProjectMove, loadProjectCockpit } from '@/services/projectIntelligence';
import { quickCreateEngines, quickCreateProjectDocument, QUICK_CREATE_ENGINES } from '@/services/projectQuickCreate';
import { openedInLibrary } from '@/components/project/workspace/library/opened';
import { listWorkspaceDocuments } from '@/components/project/workspace/library/catalog';
import { workspaceDocumentKey } from '@/components/project/workspace/library/types';
import { BridgeError, optEnum, optString, requireString, resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs } from './shared';

export async function whProjectHome(args: ToolArgs): Promise<unknown> {
  if (args.eraId !== undefined) throw new BridgeError('bad-args', 'The home overview describes the base project. Omit eraId.');
  const projectId = resolveProjectId(args), project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', 'Project no longer exists');
  const data = await loadProjectCockpit(projectId);
  const catalog = new Map((await listWorkspaceDocuments(projectId, project)).filter(row => project.enabledEngines.includes(row.engineId)).map(row => [workspaceDocumentKey(row), row]));
  const openedFromLibraryThisSession = openedInLibrary(projectId).flatMap(key => catalog.has(key) ? [catalog.get(key)!] : []);
  return { projectId, documentGrowth: data.documentGrowth, counts: data.counts, outlineCount: data.outlineCount, nextMove: deriveNextProjectMove(project.enabledEngines, data), quickCreateEngines: quickCreateEngines(project.enabledEngines), openedFromLibraryThisSession };
}

export async function whProjectQuickCreate(args: ToolArgs): Promise<unknown> {
  const engineId = optEnum(args, 'engineId', QUICK_CREATE_ENGINES);
  if (!engineId) throw new BridgeError('bad-args', 'engineId must be writings, notes or outline');
  const projectId = await resolveProjectForEngine(args, engineId), eraId = optString(args, 'eraId');
  if (eraId && engineId === 'outline') throw new BridgeError('bad-args', 'Outlines have no era storage. Create it from the base project.');
  const text = requireString(args, 'text');
  const created = await quickCreateProjectDocument({ projectId, eraId }, engineId, text);
  return withAudit({ ...created, created: true }, { projectId, entityId: created.id, table: engineId === 'outline' ? 'outlines' : engineId, summary: `created ${engineId} from project home` });
}

export const HOME_HANDLERS = { wh_project_home: whProjectHome, wh_project_quick_create: whProjectQuickCreate };
