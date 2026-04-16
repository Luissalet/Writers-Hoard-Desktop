// ============================================
// Storyboard Engine — Database Operations
// ============================================

import { makeTableOps } from '@/engines/_shared';
import { db } from '@/db';
import type { Storyboard, StoryboardPanel, StoryboardConnector } from './types';

// ===== Storyboards =====
const storyboardOps = makeTableOps<Storyboard>({
  tableName: 'storyboards',
  scopeField: 'projectId',
});

export const getStoryboards = storyboardOps.getAll;
export const getStoryboard = storyboardOps.getOne;
export const createStoryboard = storyboardOps.create;
export const updateStoryboard = storyboardOps.update;

// deleteStoryboard cascades to panels and connectors
export async function deleteStoryboard(id: string): Promise<void> {
  await db.transaction('rw', ['storyboards', 'storyboardPanels', 'storyboardConnectors'], async tx => {
    await tx.table('storyboards').delete(id);
    await tx.table('storyboardPanels').where('storyboardId').equals(id).delete();
    await tx.table('storyboardConnectors').where('storyboardId').equals(id).delete();
  });
}

// ===== Storyboard Panels =====
const panelOps = makeTableOps<StoryboardPanel>({
  tableName: 'storyboardPanels',
  scopeField: 'storyboardId',
  sortFn: (a, b) => a.order - b.order,
});

export const getPanels = panelOps.getAll;
export const getPanel = panelOps.getOne;
export const createPanel = panelOps.create;
export const updatePanel = panelOps.update;

// deletePanel cascades to connectors referencing this panel
export async function deletePanel(id: string): Promise<void> {
  await db.transaction('rw', ['storyboardPanels', 'storyboardConnectors'], async tx => {
    await tx.table('storyboardPanels').delete(id);
    await tx.table('storyboardConnectors').where('sourceId').equals(id).delete();
    await tx.table('storyboardConnectors').where('targetId').equals(id).delete();
  });
}

export async function reorderPanels(_storyboardId: string, panelIds: string[]): Promise<void> {
  await db.transaction('rw', ['storyboardPanels'], async tx => {
    for (let i = 0; i < panelIds.length; i++) {
      await tx.table('storyboardPanels').update(panelIds[i], { order: i, updatedAt: Date.now() });
    }
  });
}

// ===== Storyboard Connectors (no updatedAt field + domain-specific queries — kept manual) =====

export async function getConnectors(storyboardId: string): Promise<StoryboardConnector[]> {
  return db.table('storyboardConnectors')
    .where('storyboardId')
    .equals(storyboardId)
    .toArray() as Promise<StoryboardConnector[]>;
}

export async function getConnector(id: string): Promise<StoryboardConnector | undefined> {
  return db.table('storyboardConnectors').get(id) as Promise<StoryboardConnector | undefined>;
}

export async function createConnector(connector: StoryboardConnector): Promise<string> {
  return db.table('storyboardConnectors').add(connector) as Promise<string>;
}

export async function updateConnector(id: string, changes: Partial<StoryboardConnector>): Promise<void> {
  await db.table('storyboardConnectors').update(id, changes);
}

export async function deleteConnector(id: string): Promise<void> {
  await db.table('storyboardConnectors').delete(id);
}

export async function deleteConnectorsBySource(sourceId: string): Promise<void> {
  await db.table('storyboardConnectors').where('sourceId').equals(sourceId).delete();
}

export async function deleteConnectorsByTarget(targetId: string): Promise<void> {
  await db.table('storyboardConnectors').where('targetId').equals(targetId).delete();
}

export async function getConnectorBetweenPanels(
  fromPanelId: string,
  toPanelId: string,
): Promise<StoryboardConnector | undefined> {
  const connectors = (await db.table('storyboardConnectors')
    .where('sourceId')
    .equals(fromPanelId)
    .toArray()) as StoryboardConnector[];
  return connectors.find(c => c.targetId === toPanelId);
}
