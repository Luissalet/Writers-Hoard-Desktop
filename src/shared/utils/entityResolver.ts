// ============================================
// Cross-Engine Entity Resolution
// Resolves (entityId, entityType) → preview data
// ============================================

import type { EntityPreview } from '@/engines/_types';
import { db } from '@/db';

/**
 * Maps an entity type string to the engine that owns it.
 * Convention: entityType is either the engine ID itself ('codex', 'timeline')
 * or a more specific type within that engine ('codex-entry', 'timeline-event').
 */
const ENTITY_TYPE_TO_ENGINE: Record<string, string> = {
  // Codex
  'codex': 'codex',
  'codex-entry': 'codex',
  'character': 'codex',
  'location': 'codex',
  // Timeline
  'timeline': 'timeline',
  'timeline-event': 'timeline',
  // Writings
  'writings': 'writings',
  'writing': 'writings',
  // Yarn Board
  'yarn-board': 'yarn-board',
  'yarn-node': 'yarn-board',
  // Gallery
  'gallery': 'gallery',
  'image': 'gallery',
  // Maps
  'maps': 'maps',
  'map-pin': 'maps',
  // Links
  'links': 'links',
  'link': 'links',
  // Scrapper
  'scrapper': 'scrapper',
  'snapshot': 'scrapper',
  // Dialog / Scene
  'dialog-scene': 'dialog-scene',
  'scene': 'dialog-scene',
  'dialog-block': 'dialog-scene',
  // Storyboard
  'storyboard': 'storyboard',
  'panel': 'storyboard',
  // Biography
  'biography': 'biography',
  'biography-fact': 'biography',
  // Video Planner
  'video-planner': 'video-planner',
  'video-segment': 'video-planner',
  // Brainstorm
  'brainstorm': 'brainstorm',
};

export function entityTypeToEngineId(entityType: string): string | undefined {
  return ENTITY_TYPE_TO_ENGINE[entityType];
}

/**
 * Resolve an entity to a preview card. Returns null if the engine
 * doesn't implement getPreview or the entity doesn't exist.
 */
export async function resolveEntity(
  entityId: string,
  entityType: string,
): Promise<EntityPreview | null> {
  const engineId = ENTITY_TYPE_TO_ENGINE[entityType];
  if (!engineId) return null;

  switch (engineId) {
    case 'codex': {
      const entry = await db.codexEntries.get(entityId);
      if (!entry) return null;
      return { id: entry.id, type: entityType, engineId, title: entry.title, subtitle: entry.type, thumbnail: entry.avatar };
    }
    case 'timeline': {
      const event = await db.timelineEvents.get(entityId);
      if (!event) return null;
      return { id: event.id, type: entityType, engineId, title: event.title, subtitle: event.date, color: event.color };
    }
    case 'writings': {
      const writing = await db.writings.get(entityId);
      if (!writing) return null;
      return { id: writing.id, type: entityType, engineId, title: writing.title, subtitle: writing.status };
    }
    case 'yarn-board': {
      const node = await db.yarnNodes.get(entityId);
      if (!node) return null;
      return { id: node.id, type: entityType, engineId, title: node.title, subtitle: node.type, thumbnail: node.image, color: node.color };
    }
    case 'gallery': {
      const image = await db.inspirationImages.get(entityId);
      if (!image) return null;
      return { id: image.id, type: entityType, engineId, title: image.notes || 'Image', thumbnail: image.thumbnailData ?? image.imageData };
    }
    case 'maps': {
      const pin = await db.mapPins.get(entityId);
      if (!pin) return null;
      return { id: pin.id, type: entityType, engineId, title: pin.name, subtitle: pin.description };
    }
    case 'links': {
      const link = await db.externalLinks.get(entityId);
      if (!link) return null;
      return { id: link.id, type: entityType, engineId, title: link.title, subtitle: link.url, thumbnail: link.thumbnail };
    }
    case 'scrapper': {
      const snap = await db.snapshots.get(entityId);
      if (!snap) return null;
      return { id: snap.id, type: entityType, engineId, title: snap.title, subtitle: snap.url, thumbnail: snap.thumbnail };
    }
    case 'dialog-scene': {
      const scene = await db.scenes.get(entityId);
      if (!scene) return null;
      return { id: scene.id, type: entityType, engineId, title: scene.title, subtitle: scene.setting };
    }
    case 'storyboard': {
      const board = await db.storyboards.get(entityId);
      if (!board) return null;
      return { id: board.id, type: entityType, engineId, title: board.title };
    }
    case 'biography': {
      const bio = await db.biographies.get(entityId);
      if (!bio) return null;
      return { id: bio.id, type: entityType, engineId, title: bio.subjectName, thumbnail: bio.subjectPhoto };
    }
    case 'video-planner': {
      const plan = await db.videoPlans.get(entityId);
      if (!plan) return null;
      return { id: plan.id, type: entityType, engineId, title: plan.title };
    }
    case 'brainstorm': {
      const board = await db.brainstormBoards.get(entityId);
      if (!board) return null;
      return { id: board.id, type: entityType, engineId, title: board.title };
    }
    default:
      return null;
  }
}

/**
 * Search across all engines (or a subset) for entities matching a query.
 */
export async function searchEntities(
  query: string,
  engineIds?: string[],
): Promise<EntityPreview[]> {
  if (!query.trim()) return [];

  const q = query.toLowerCase();

  // Unique engine IDs from the map when no filter is provided
  const engines = engineIds ?? [...new Set(Object.values(ENTITY_TYPE_TO_ENGINE))];

  const results = await Promise.all(
    engines.map(async (engineId): Promise<EntityPreview[]> => {
      switch (engineId) {
        case 'codex': {
          const rows = await db.codexEntries.filter(e => e.title.toLowerCase().includes(q)).toArray();
          return rows.map(e => ({ id: e.id, type: e.type, engineId, title: e.title, subtitle: e.type, thumbnail: e.avatar }));
        }
        case 'timeline': {
          const rows = await db.timelineEvents.filter(e => e.title.toLowerCase().includes(q)).toArray();
          return rows.map(e => ({ id: e.id, type: 'timeline-event', engineId, title: e.title, subtitle: e.date, color: e.color }));
        }
        case 'writings': {
          const rows = await db.writings.filter(w => w.title.toLowerCase().includes(q)).toArray();
          return rows.map(w => ({ id: w.id, type: 'writing', engineId, title: w.title, subtitle: w.status }));
        }
        case 'yarn-board': {
          const rows = await db.yarnNodes.filter(n => n.title.toLowerCase().includes(q)).toArray();
          return rows.map(n => ({ id: n.id, type: 'yarn-node', engineId, title: n.title, subtitle: n.type, thumbnail: n.image, color: n.color }));
        }
        case 'gallery': {
          const rows = await db.inspirationImages.filter(i => (i.notes || '').toLowerCase().includes(q)).toArray();
          return rows.map(i => ({ id: i.id, type: 'image', engineId, title: i.notes || 'Image', thumbnail: i.thumbnailData ?? i.imageData }));
        }
        case 'maps': {
          const rows = await db.mapPins.filter(p => p.name.toLowerCase().includes(q)).toArray();
          return rows.map(p => ({ id: p.id, type: 'map-pin', engineId, title: p.name, subtitle: p.description }));
        }
        case 'links': {
          const rows = await db.externalLinks.filter(l => l.title.toLowerCase().includes(q)).toArray();
          return rows.map(l => ({ id: l.id, type: 'link', engineId, title: l.title, subtitle: l.url, thumbnail: l.thumbnail }));
        }
        case 'scrapper': {
          const rows = await db.snapshots.filter(s => s.title.toLowerCase().includes(q)).toArray();
          return rows.map(s => ({ id: s.id, type: 'snapshot', engineId, title: s.title, subtitle: s.url, thumbnail: s.thumbnail }));
        }
        case 'dialog-scene': {
          const rows = await db.scenes.filter(s => s.title.toLowerCase().includes(q)).toArray();
          return rows.map(s => ({ id: s.id, type: 'scene', engineId, title: s.title, subtitle: s.setting }));
        }
        case 'storyboard': {
          const rows = await db.storyboards.filter(b => b.title.toLowerCase().includes(q)).toArray();
          return rows.map(b => ({ id: b.id, type: 'storyboard', engineId, title: b.title }));
        }
        case 'biography': {
          const rows = await db.biographies.filter(b => b.subjectName.toLowerCase().includes(q)).toArray();
          return rows.map(b => ({ id: b.id, type: 'biography', engineId, title: b.subjectName, thumbnail: b.subjectPhoto }));
        }
        case 'video-planner': {
          const rows = await db.videoPlans.filter(v => v.title.toLowerCase().includes(q)).toArray();
          return rows.map(v => ({ id: v.id, type: 'video-planner', engineId, title: v.title }));
        }
        case 'brainstorm': {
          const rows = await db.brainstormBoards.filter(b => b.title.toLowerCase().includes(q)).toArray();
          return rows.map(b => ({ id: b.id, type: 'brainstorm', engineId, title: b.title }));
        }
        default:
          return [];
      }
    })
  );

  return results.flat();
}
