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
  tables: {
    genealogyLinks:
      'id, projectId, from, to, kind, [projectId+from], [projectId+to], updatedAt',
  },
  component: GenealogyTreeView,
};

registerEngine(genealogyEngine);

registerEntityResolver({
  engineId: 'genealogy',
  entityTypes: ['genealogyLink'],
  resolveEntity: async (entityId: string) => {
    const link = await db.genealogyLinks.get(entityId);
    if (!link) return null;
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
    return rows.map((r) => ({
      id: r.id,
      type: 'genealogyLink',
      engineId: 'genealogy',
      projectId: r.projectId,
      title: `${r.from} —${r.kind}→ ${r.to}`,
    }));
  },
});

registerBackupStrategy(
  makeSimpleBackupStrategy({
    engineId: 'genealogy',
    tables: ['genealogyLinks'],
  }),
);

export { genealogyEngine };
