// ============================================================================
// AI bridge tools — orientation: what is open, what exists, what mentions X
// ============================================================================

import { db } from '@/db';
import { getAllProjects, updateProject } from '@/db/operations';
import { searchProjectContent } from '@/services/projectSearchIndex';
import { useAppStore } from '@/stores/appStore';
import { BRIDGE_ENGINE_IDS } from '../manifest';
import {
  BridgeError,
  clampLimit,
  currentEngineId,
  optNumber,
  optString,
  requireString,
  resolveProjectId,
  withAudit,
  type ToolArgs,
} from './shared';

/** Cheap per-project totals so a model can judge where the material is. */
async function countsFor(projectId: string): Promise<Record<string, number>> {
  const [writings, codex, diary, events] = await Promise.all([
    db.writings.where('projectId').equals(projectId).count(),
    db.codexEntries.where('projectId').equals(projectId).count(),
    db.diaryEntries.where('projectId').equals(projectId).count(),
    db.timelineEvents.where('projectId').equals(projectId).count(),
  ]);
  return { writings, codex, diary, events };
}

/**
 * Whether the writes switch is on, asked of the process that owns it.
 *
 * The flag lives in the main process's config, not in Dexie, so the renderer
 * has to go and get it. Reported here because the tool's description says it
 * is — a model that finds out by having a write refused learns it too late.
 */
async function writesPermitted(): Promise<boolean | null> {
  try {
    const info = await window.electronAPI?.aiBridge?.getInfo();
    return info ? info.writesEnabled : null;
  } catch {
    // Never let orientation fail over a status flag.
    return null;
  }
}

export async function whGetContext(): Promise<unknown> {
  const projectId = useAppStore.getState().currentProjectId;
  const writesEnabled = await writesPermitted();
  if (!projectId) {
    return {
      openProject: null,
      openEngine: null,
      writesEnabled,
      hint: 'No project is open. Call wh_list_projects and pass projectId explicitly on the tools that need it.',
    };
  }
  const project = await db.projects.get(projectId);
  if (!project) return { openProject: null, openEngine: null, writesEnabled };
  return {
    openProject: {
      id: project.id,
      title: project.title,
      description: project.description,
      mode: project.mode,
      status: project.status,
      // Anything not in here has no tab and is skipped by the app's own
      // search, so a write into it is refused. wh_enable_engine turns one on.
      enabledEngines: project.enabledEngines,
      counts: await countsFor(project.id),
    },
    openEngine: currentEngineId(),
    writesEnabled,
  };
}

export async function whListProjects(): Promise<unknown> {
  const projects = await getAllProjects();
  const openId = useAppStore.getState().currentProjectId;
  return {
    projects: await Promise.all(
      projects.map(async (project) => ({
        id: project.id,
        title: project.title,
        description: project.description,
        mode: project.mode,
        type: project.type,
        status: project.status,
        enabledEngines: project.enabledEngines,
        isOpen: project.id === openId,
        counts: await countsFor(project.id),
        updatedAt: project.updatedAt,
      })),
    ),
  };
}

/**
 * Switch an engine on for a project.
 *
 * Deliberately one-way. Enabling adds a tab and makes existing rows findable
 * again — additive, reversible by the writer in one click. Disabling hides
 * material they can no longer search for, and that is not a model's call to
 * make; there is no wh_disable_engine and there should not be.
 */
export async function whEnableEngine(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  const engineId = requireString(args, 'engineId');
  if (!BRIDGE_ENGINE_IDS.includes(engineId)) {
    throw new BridgeError(
      'bad-args',
      `"${engineId}" is not an engine this bridge works with. Known: ${BRIDGE_ENGINE_IDS.join(', ')}.`,
    );
  }
  const project = await db.projects.get(projectId);
  if (!project) throw new BridgeError('not-found', `No project with id "${projectId}".`);

  if (project.enabledEngines.includes(engineId)) {
    return { projectId, engineId, alreadyEnabled: true, enabledEngines: project.enabledEngines };
  }
  const enabledEngines = [...project.enabledEngines, engineId];
  // engineOrder is left alone on purpose: getOrderedEnabledEngineIds appends
  // anything enabled that the order does not mention, so the tab shows up at
  // the end and the writer's own arrangement of the rest is untouched.
  await updateProject(projectId, { enabledEngines, updatedAt: Date.now() });
  return withAudit(
    { projectId, engineId, enabled: true, enabledEngines },
    {
      projectId,
      entityId: projectId,
      summary: `switched on the "${engineId}" engine in "${project.title}"`,
      before: { enabledEngines: project.enabledEngines },
    },
  );
}

export async function whSearch(args: ToolArgs): Promise<unknown> {
  const query = requireString(args, 'query');
  const projectId = optString(args, 'projectId') ?? useAppStore.getState().currentProjectId ?? undefined;
  const limit = clampLimit(optNumber(args, 'limit'), 8, 50);
  const hits = await searchProjectContent(query, projectId, limit);
  return {
    query,
    projectId: projectId ?? null,
    hits,
    hint: hits.length
      ? 'Use the engineId and id of a hit with the matching read tool (wh_get_writing, wh_get_codex_entry...).'
      : 'Nothing matched. Queries under 3 characters are ignored; try a distinctive name instead.',
  };
}
