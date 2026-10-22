import { createCodexEntry } from '@/db/operations';
import { announceEraChange, assertWorldEra, saveEraDocument } from '@/services/worldEras/store';
import type { EraRow, WorldEraScope } from '@/services/worldEras/types';
import { generateId } from '@/utils/idGenerator';
import { getTemplateFields, type CodexEntry, type CodexEntryType } from '@/types';

const TYPES: CodexEntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];

/**
 * Creates a plain Codex entry from a map ("create as {type}" in the link picker,
 * "new entry here" in the right-click menu). It lands in the era the map is
 * being edited in, like any other entry made there.
 */
export async function createEntryFromMap(scope: WorldEraScope, title: string, type: CodexEntryType): Promise<string> {
  const name = title.trim();
  if (!name) throw Error('entry_title_required');
  if (!TYPES.includes(type)) throw Error('entity_type_invalid');
  const project = await assertWorldEra(scope);
  if (!project.enabledEngines.includes('codex')) throw Error('codex_engine_disabled');
  const now = Date.now();
  const entry: CodexEntry = { id: generateId('codex'), projectId: scope.projectId, title: name, type, fields: getTemplateFields(type), content: '', tags: [], relations: [], createdAt: now, updatedAt: now };
  if (scope.eraId) await saveEraDocument(scope, 'codex', { root: entry as unknown as EraRow, children: {} }, null);
  else await createCodexEntry(entry);
  announceEraChange(scope.projectId);
  return entry.id;
}
