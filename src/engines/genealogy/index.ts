import { lazy } from 'react';
import { Network } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { db } from '@/db';

const GenealogyTreeView = lazy(() => import('./components/GenealogyTreeView'));

const genealogyEngine: EngineDefinition = {
  id: 'genealogy',
  name: 'Genealogy',
  description: 'Family tree of your characters — parents, guardians and partners',
  icon: Network,
  category: 'planning',
  countProjectItems: async (projectId) => {
    const project = await db.projects.get(projectId);
    return project?.relationTrees?.length ?? 0;
  },
  tables: {
    genealogyLinks:
      'id, projectId, from, to, kind, [projectId+from], [projectId+to], updatedAt',
  },
  component: GenealogyTreeView,
};

registerEngine(genealogyEngine);

registerEntityResolver({
  engineId: 'genealogy',
  entityTypes: ['genealogyLink', 'relation-tree'],
  resolveEntity: async (entityId: string) => {
    const link = await db.genealogyLinks.get(entityId);
    if (!link) {
      for (const project of await db.projects.toArray()) { const tree = project.relationTrees?.find(tree => tree.id === entityId); if (tree) return { id: tree.id, type: 'relation-tree', engineId: 'genealogy', projectId: project.id, title: tree.title }; }
      return null;
    }
    return {
      id: link.id,
      type: 'genealogyLink',
      engineId: 'genealogy',
      projectId: link.projectId,
      title: `${link.from} —${link.kind}→ ${link.to}`,
    };
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    const base = projectId
      ? db.genealogyLinks.where('projectId').equals(projectId)
      : db.genealogyLinks.toCollection();
    const rows = await base
      .filter((r) => r.from.toLowerCase().includes(q) || r.to.toLowerCase().includes(q))
      .toArray();
    const links = rows.map((r) => ({
      id: r.id,
      type: 'genealogyLink',
      engineId: 'genealogy',
      projectId: r.projectId,
      title: `${r.from} —${r.kind}→ ${r.to}`,
    }));
    const projects = projectId ? [await db.projects.get(projectId)] : await db.projects.toArray();
    const trees = projects.flatMap(project => project ? (project.relationTrees ?? []).filter(tree => [tree.title, ...tree.nodes.map(node => node.label), ...(tree.annotations ?? []).flatMap(annotation => annotation.kind === 'text' ? [annotation.text] : [])].some(text => text.toLocaleLowerCase().includes(q))).map(tree => ({ id: tree.id, type: 'relation-tree', engineId: 'genealogy', projectId: project.id, title: tree.title })) : []);
    return [...links, ...trees];
  },
});

registerBackupStrategy(
  makeSimpleBackupStrategy({
    engineId: 'genealogy',
    tables: ['genealogyLinks'],
  }),
);

export { genealogyEngine };
