import { useMemo } from 'react';
import type { CodexEntry } from '@/types';
import { useProject } from '@/hooks/useProjects';
import { useRelationships } from '@/engines/relationships/hooks';
import { useTranslation } from '@/i18n/useTranslation';
import { useWorldGraph } from './useWorldGraph';
import WorldGraphWorkspace from './WorldGraphWorkspace';
import { saveWorldGraphLayout , saveWorldGraphSettings } from './store';
import { worldGraphCopy } from './copy';
import { useWorkspacePaneFocus } from '@/components/project/workspace/useWorkspacePaneFocus';
import { useWorldEraScope } from '@/services/worldEras/hooks';

export default function WorldGraphPane({ projectId, entries, onOpenEntry }: { projectId: string; entries: CodexEntry[]; onOpenEntry: (id: string) => void }) {
  const { project, loading: projectLoading, refresh } = useProject(projectId);
  const { items: relationships, loading: relationshipsLoading, error: relationshipsError, refresh: refreshRelationships } = useRelationships(projectId);
  const { locale } = useTranslation(); const copy = worldGraphCopy[locale];
  const templates = project?.codexTemplates;
  const referenceLabels = useMemo(() => {
    const byTemplate = new Map((templates ?? []).map(template => [template.id, template]));
    return Object.fromEntries(entries.map(entry => [entry.id, Object.fromEntries((byTemplate.get(entry.templateId ?? '')?.referenceFieldDefinitions ?? []).map(definition => [definition.key, definition.label]))]));
  }, [entries, templates]);
  const contentReferenceLabels = useMemo(() => ({ link: copy.textLink, block: copy.codexBlock }), [copy.textLink, copy.codexBlock]);
  const input = useMemo(() => ({ projectId, entries, relationships, referenceLabels, contentReferenceLabels }), [projectId, entries, relationships, referenceLabels, contentReferenceLabels]);
  const { graph, indexing, error, retry } = useWorldGraph(input);
  const { eraId } = useWorldEraScope(projectId);
  const fullscreen = useWorkspacePaneFocus({ projectId, eraId, namespace: 'world-graph' }, !!project && !!graph && !error && !projectLoading && !relationshipsLoading);
  const avatars = useMemo(() => Object.fromEntries(entries.filter(entry => entry.projectId === projectId && entry.avatar).map(entry => [entry.id, entry.avatar!])), [entries, projectId]);
  if (projectLoading || relationshipsLoading || (!graph && !error)) return <p className="p-6 text-sm text-text-muted" role="status">{copy.indexing}</p>;
  if (!project || error || !graph) return <div className="p-6 text-sm text-danger" role="alert">{copy.failed}<button type="button" onClick={() => { retry(); void refresh(); }} className="ml-3 underline">{copy.retry}</button></div>;
  return <div className={fullscreen.active ? 'flex h-full min-h-0 flex-col' : 'space-y-3'}>
    {relationshipsError && <p role="alert" className="text-sm text-danger">{copy.relationsFailed}<button type="button" onClick={() => void refreshRelationships()} className="ml-3 underline">{copy.retry}</button></p>}
    <WorldGraphWorkspace key={projectId} graph={graph} templates={templates} initialLayout={project.codexGraphLayout} avatars={avatars} onOpenEntry={onOpenEntry} onSaveLayout={positions => saveWorldGraphLayout(projectId, positions)} onSaveSettings={patch => saveWorldGraphSettings(projectId, patch).then(() => undefined)} indexing={indexing} fullscreen={fullscreen} />
  </div>;
}
