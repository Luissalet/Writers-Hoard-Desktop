import { db } from '@/db';
import { deleteCodexEntry } from '@/db/operations';
import { createEntryFromMap } from '@/engines/maps/codexLink';
import { announceEraChange, hideEraDocument, readEraRow, readWorldDocument } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { CodexEntry, CodexEntryType } from '@/types';
import type { EntityLink } from '@/types/projectTools';
import { stableText } from '@/services/aiBridge/undoStamp';
import { generateId } from '@/utils/idGenerator';
import { targetFromKey } from './core/edits';
import { openWorldForReading } from './bridgeAccess';
import { deleteWorldLink, listWorldLinks, saveWorldLink, worldgenScopeOperations } from './era';

export interface PlaceCardReceipt { worldId: string; card: CodexEntry; link: EntityLink }

/** One confirmed mutation: a normal Codex card and the atlas' existing manuscript link. */
export async function createPlaceCard(scope: WorldEraScope, worldId: string, place: { key: string; name: string }, type: CodexEntryType): Promise<PlaceCardReceipt> {
  const source = await worldgenScopeOperations(scope).worlds.getOne(worldId);
  if (!source || source.projectId !== scope.projectId) throw Error('world_missing');
  if (!targetFromKey(place.key)) throw Error('place_key_invalid');
  const opened = await openWorldForReading(source, 'full', scope.eraId);
  if (!opened.ok) throw Error(opened.message);
  const currentPlace = opened.world.atlas.byKey.get(place.key);
  if (!currentPlace || currentPlace.name !== place.name) throw Error('place_changed');
  const result = await db.transaction('rw', db.tables, async () => {
    const world = await worldgenScopeOperations(scope).worlds.getOne(worldId);
    if (!world || world.projectId !== scope.projectId) throw Error('world_missing');
    if (stableText([world.params, world.edits]) !== stableText([source.params, source.edits])) throw Error('place_changed');
    const project = await db.projects.get(scope.projectId);
    if (!project?.enabledEngines.includes('worldgen')) throw Error('worldgen_engine_disabled');
    if (!targetFromKey(place.key)) throw Error('place_key_invalid');
    const id = await createEntryFromMap(scope, place.name, type);
    const card = (await readEraRow<CodexEntry>(scope, 'codexEntries', id))!;
    const now = Date.now();
    const link: EntityLink = {
      id: generateId('entity-link'), projectId: scope.projectId,
      sourceEngineId: 'worldgen', sourceEntityType: 'world-spatial', sourceEntityId: `${worldId}::${place.key}`, sourceTitle: card.title,
      targetEngineId: 'codex', targetEntityType: 'codex-entry', targetEntityId: id, targetTitle: card.title,
      relation: 'represents', provenance: 'manual', createdAt: now, updatedAt: now,
    };
    await saveWorldLink(scope, worldId, link);
    return { worldId, card, link };
  });
  announceEraChange(scope.projectId);
  return result;
}

/** Refuse the whole reversal if either half has changed; never remove a later edit. */
export async function undoPlaceCard(scope: WorldEraScope, receipt: PlaceCardReceipt): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const world = await worldgenScopeOperations(scope).worlds.getOne(receipt.worldId);
    const card = await readEraRow<CodexEntry>(scope, 'codexEntries', receipt.card.id);
    const links = await listWorldLinks(scope, receipt.worldId);
    const link = links.find(row => row.id === receipt.link.id);
    if (!world || world.projectId !== scope.projectId || receipt.card.projectId !== scope.projectId || receipt.link.projectId !== scope.projectId
      || stableText(card) !== stableText(receipt.card) || stableText(link) !== stableText(receipt.link)
      || links.some(row => row.targetEntityId === receipt.card.id && row.id !== receipt.link.id)) throw Error('place_card_changed');
    if (await db.sceneCasts.filter(row => row.characterId === receipt.card.id).count()
      || await db.annotationReferences.where('targetEntityId').equals(receipt.card.id).count()) throw Error('place_card_referenced');
    // The card may be unchanged while another editor has since used it. Do not
    // cascade away those pins, relationships, prose references or sibling-era links.
    for (const table of db.tables) {
      if (['documentHistory', 'documentArchives', 'worldEraAssets', 'writingSnapshots'].includes(table.name)) continue;
      const rows = table.name === 'projects' ? [await db.projects.get(scope.projectId)] : table.schema.idxByName.projectId ? await table.where('projectId').equals(scope.projectId).toArray() : [];
      for (const row of rows) {
        if (!row || table.name === 'codexEntries' && row.id === receipt.card.id || table.name === 'entityLinks' && row.id === receipt.link.id
          || table.name === 'worldEraVariants' && row.entityId === receipt.card.id && row.eraId === scope.eraId && row.kind === 'codex') continue;
        const liveRow = table.name === 'worldEraVariants' ? { ...row, history: undefined } : row;
        if (stableText(liveRow).replaceAll(stableText(receipt.link), 'null').includes(receipt.card.id)) throw Error(`place_card_referenced:${table.name}`);
      }
    }
    await deleteWorldLink(scope, receipt.worldId, receipt.link.id);
    if (scope.eraId) {
      const current = await readWorldDocument(scope, 'codex', receipt.card.id);
      if (!current) throw Error('place_card_changed');
      await hideEraDocument(scope, 'codex', receipt.card.id, current.version);
    } else await deleteCodexEntry(receipt.card.id);
  });
  announceEraChange(scope.projectId);
}
