import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { db } from '@/db';
import RelationshipsEngine from '@/engines/relationships/components/RelationshipsEngine';
import { loadProjectCockpit } from '@/services/projectIntelligence';
import { flushPendingWrites } from '@/services/pendingWrites';
import type { Relationship } from '@/engines/relationships/types';

function SwitchRelationship({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  return <><button data-testid="switch-relation" onClick={() => navigate('?entity=workflow-rel-b')}>Switch</button><RelationshipsEngine projectId={projectId} /></>;
}

export async function testProjectUserFlows(): Promise<string[]> {
  const projectId = 'project-userflow-fixture';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const wait = () => new Promise(resolve => setTimeout(resolve, 30));
  const relation = (id: string, label: string): Relationship => ({
    id, projectId, entityAId: 'a', entityAType: 'codex-entry', entityAName: 'A',
    entityBId: 'b', entityBType: 'codex-entry', entityBName: 'B', kind: 'ally', intensity: 2,
    label, notes: '', state: 'current', directional: true, createdAt: 1, updatedAt: 1,
  });
  try {
    await db.projects.put({ id: projectId, title: 'Concepts', description: '', color: '#aaa', type: 'idea', mode: 'custom', status: 'draft', enabledEngines: ['board', 'relationships'], engineOrder: ['board', 'relationships'], createdAt: 1, updatedAt: 1 });
    await db.boards.put({ id: 'workflow-board', projectId, title: 'Map of ideas', surface: 'plain', createdAt: 10, updatedAt: 10 });
    await db.relationships.bulkPut([relation('workflow-rel-a', 'First tie'), relation('workflow-rel-b', 'Second tie')]);
    const cockpit = await loadProjectCockpit(projectId);
    if (!cockpit.entities.some(item => item.id === 'workflow-board') || !cockpit.recent.some(item => item.id === 'workflow-board')) throw new Error('Concept board is absent from project organization or recent work');
    if (!cockpit.entities.some(item => item.id === 'workflow-rel-a')) throw new Error('Relationships are absent from project organization');
    await act(async () => { root.render(<MemoryRouter initialEntries={['/?entity=workflow-rel-a']}><SwitchRelationship projectId={projectId} /></MemoryRouter>); await wait(); });
    for (let i = 0; i < 30 && !document.querySelector('[role="dialog"] input[value="First tie"]'); i++) await act(wait);
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[value="First tie"]');
    if (!input) throw new Error('Search deep link did not open the exact relationship');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'First tie revised');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="switch-relation"]')!.click(); });
    await act(async () => { await flushPendingWrites(); await wait(); });
    if ((await db.relationships.get('workflow-rel-a'))?.label !== 'First tie revised') throw new Error('Original relationship did not retain the pending edit');
    if ((await db.relationships.get('workflow-rel-b'))?.label !== 'Second tie') throw new Error('Pending edit crossed into the next relationship');
    if (!document.querySelector('[role="dialog"] input[value="Second tie"]')) throw new Error('Second relationship did not show its own text');
    return ['Project hub and recent work include concept boards and relationships', 'Relationship links open the exact item; navigation preserves edit ownership'];
  } finally {
    await act(async () => root.unmount());
    host.remove();
    await db.relationships.where('projectId').equals(projectId).delete();
    await db.boards.delete('workflow-board');
    await db.projects.delete(projectId);
  }
}
