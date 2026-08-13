import { lazy } from 'react';

// ============================================
// Notes Engine — Registration
// ============================================

import { StickyNote } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine, registerEntityResolver } from '@/engines/_registry';
import { registerBackupStrategy, makeSimpleBackupStrategy } from '@/engines/_shared';
import { registerAnchorAdapter, navigateTo } from '@/engines/_shared/anchoring';
import { t } from '@/i18n/useTranslation';
import { db } from '@/db';
const NotesEngine = lazy(() => import('./components/NotesEngine'));
import { GLOBAL_NOTES_SCOPE, noteTitle, NOTE_KIND_META } from './types';
import type { Note } from './types';

const notesEngine: EngineDefinition = {
  id: 'notes',
  name: 'Notes',
  description: 'Quick capture for short thoughts, quotes and stray ideas',
  icon: StickyNote,
  category: 'core',
  tables: {
    notes: 'id, projectId, kind, *tags, pinned, createdAt',
  },
  component: NotesEngine,
};

registerEngine(notesEngine);

registerEntityResolver({
  engineId: 'notes',
  entityTypes: ['notes', 'note'],
  resolveEntity: async (entityId: string, entityType: string) => {
    const note = (await db.table('notes').get(entityId)) as Note | undefined;
    if (!note) return null;
    return {
      id: note.id,
      type: entityType,
      engineId: 'notes',
      projectId: note.projectId,
      title: noteTitle(note),
      subtitle: note.source,
      color: note.color ?? NOTE_KIND_META[note.kind].color,
    };
  },
  searchEntities: async (query: string, projectId?: string) => {
    const q = query.toLowerCase();
    const table = db.table('notes');
    const base = projectId ? table.where('projectId').equals(projectId) : table.toCollection();
    const rows = (await base
      .filter((n: Note) =>
        n.text.toLowerCase().includes(q) ||
        (n.source ?? '').toLowerCase().includes(q) ||
        n.tags.some((tag) => tag.toLowerCase().includes(q)),
      )
      .toArray()) as Note[];
    return rows.map((n) => ({
      id: n.id,
      type: 'note',
      engineId: 'notes',
      projectId: n.projectId,
      title: noteTitle(n),
      subtitle: n.source,
      color: n.color ?? NOTE_KIND_META[n.kind].color,
    }));
  },
});

// Project-scoped notes ride along in each project's folder. Inbox notes
// (projectId === GLOBAL_NOTES_SCOPE) belong to no project, so the full-backup
// path in services/zipBackup.ts writes them to a top-level `notes-inbox.json`.
registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'notes',
  tables: ['notes'],
}));

// Entity-level anchoring only: a note IS the smallest unit, so there's nothing
// to text-range into. Registering makes notes referenceable from margin
// annotations and — the everyday win — makes a note found in Cmd+K actually
// navigable. The note itself knows where it lives, so inbox captures land on
// /notes instead of a project tab that doesn't hold them.
registerAnchorAdapter({
  engineId: 'notes',
  supportsTextRange: false,
  async getEntityTitle(entityId: string) {
    const note = (await db.table('notes').get(entityId)) as Note | undefined;
    return note ? noteTitle(note) : null;
  },
  getEngineChipLabel: () => t('annotations.chipLabel.notes'),
  navigateToEntity(entityId: string) {
    void (async () => {
      const note = (await db.table('notes').get(entityId)) as Note | undefined;
      if (!note) return;
      navigateTo(
        note.projectId === GLOBAL_NOTES_SCOPE
          ? '/notes'
          : `/project/${note.projectId}/notes`,
      );
    })();
  },
});

export { notesEngine };
