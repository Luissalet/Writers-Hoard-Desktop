// ============================================================================
// AI bridge — undoing a logged change
// ============================================================================
//
// The audit log records what each write did and what the row looked like
// before. This turns one of those lines back:
//
//   create → delete the row (or every row the call made), through the
//            engine's own cascade operation
//   update → put the recorded fields back
//   delete → reinsert the row (its cascaded children do NOT come back)
//
// It is deliberately honest about the last case. Restoring a deleted scene
// brings the scene back but not its dialog; saying so is better than a green
// tick that hides it.

import type { PublishingProfile } from '@/types/projectTools';
import { db } from '@/db';
import { DELETABLE } from './tools/deletion';
import { undoEnrichment } from '@/engines/inquiry/enrichment';
import { BridgeError, type ToolArgs } from './tools/shared';
import { diceStamp, encounterStamp, graphStamp, kanbansStamp, soundscapesStamp, tableRulesStamp, todosStamp } from './undoStamp';
import { hideEraDocument, mutateEraRows, readEraRow, readWorldDocument, saveEraDocument } from '@/services/worldEras/store';
import { eraAdapterForTable } from '@/services/worldEras/adapters';
import type { EraDocumentKind } from '@/services/worldEras/types';

export interface UndoResult {
  undone: boolean;
  kind: string;
  entityId: string;
  entityIds?: string[];
  what: string;
  /** Set when the reversal is partial, and why. */
  caveat?: string;
}

/**
 * Which table holds this id, found by asking each of them.
 *
 * Cheaper than it looks — a primary-key `get` on ~45 tables — and far more
 * reliable than guessing from an id prefix, which only holds for rows the
 * bridge created: plenty of the user's own rows are bare UUIDs.
 */
async function findTable(id: string): Promise<string | null> {
  for (const table of db.tables) {
    try {
      if (await table.get(id)) return table.name;
    } catch {
      // A table whose primary key is not a string simply never matches.
    }
  }
  return null;
}

/** The registry entry whose table this is, when there is one. */
function specForTable(table: string): { type: string; remove: (id: string) => Promise<void> } | null {
  for (const [type, spec] of Object.entries(DELETABLE)) {
    if (spec.table === table) return { type, remove: spec.remove };
  }
  return null;
}

/**
 * Refuse to put a snapshot back over later work. The write recorded what it left
 * behind (a revision and a fingerprint of the content); if the data now is neither,
 * someone changed it since and restoring would silently drop that. Lines written
 * before this was recorded carry neither and keep their old behaviour.
 */
function assertUnchangedSince(recorded: Record<string, unknown>, current: { revision?: number; stamp: string }, what: string) {
  if (recorded.__after === undefined && recorded.__afterRevision === undefined) return;
  if (typeof recorded.__afterRevision === 'number' && current.revision === recorded.__afterRevision) return;
  if (recorded.__after === current.stamp) return;
  throw new BridgeError('cannot-undo', `The ${what} changed after this edit, so undoing it would lose that later work; change them back by hand instead.`);
}

export async function undoAuditEntry(args: ToolArgs): Promise<UndoResult> {
  let entry = args.entry as Record<string, unknown> | undefined;
  if (!entry) throw new BridgeError('bad-args', 'No audit entry was passed to undo.');

  const kind = String(entry.kind ?? '');
  const entityId = typeof entry.entityId === 'string' ? entry.entityId : '';
  const summary = typeof entry.summary === 'string' ? entry.summary : 'that change';
  // One call can create several rows — four images, a page of clippings. Older
  // lines only ever recorded one, so `entityId` still stands on its own.
  const listed = Array.isArray(entry.entityIds)
    ? entry.entityIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : [];
  if (!entityId && !listed.length) {
    throw new BridgeError(
      'cannot-undo',
      'That entry records no entity, so there is nothing to put back. Bulk imports are not reversible this way.',
    );
  }

  if (['wh_parallel_draft_create', 'wh_parallel_draft_save', 'wh_parallel_draft_history_restore'].includes(String(entry.tool)) && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object') {
    const { undoParallelDraftChange } = await import('@/engines/writings/parallelDraftUndo');
    const id = await undoParallelDraftChange(entry.projectId, typeof entry.eraId === 'string' ? entry.eraId : undefined, entry.before as Record<string, unknown>);
    return { undone: true, kind, entityId: id, what: summary };
  }

  if (entry.tool === 'wh_set_world_presentation' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object' && '__worldPresentation' in entry.before) {
    const { revertWorldPresentation } = await import('@/engines/worldgen/presentation');
    const receipt = (entry.before as { __worldPresentation: import('@/engines/worldgen/presentation').PresentationReceipt }).__worldPresentation;
    const result = await revertWorldPresentation({ projectId: entry.projectId, eraId: typeof entry.eraId === 'string' ? entry.eraId : undefined }, entityId, receipt);
    return { undone: result.reverted.length > 0, kind, entityId, what: summary, caveat: result.kept.length ? `Changed again since, kept as they are: ${result.kept.join(', ')}.` : undefined };
  }

  if (entry.tool === 'wh_set_world_travel_settings' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object' && '__worldTravelSettings' in entry.before) {
    const { revertWorldTravelSettings } = await import('@/engines/worldgen/journeyOperations');
    const receipt = (entry.before as { __worldTravelSettings: import('@/engines/worldgen/journeyOperations').TravelSettingsReceipt }).__worldTravelSettings;
    const result = await revertWorldTravelSettings({ projectId: entry.projectId, eraId: typeof entry.eraId === 'string' ? entry.eraId : undefined }, entityId, receipt);
    return { undone: result.reverted.length > 0, kind, entityId, what: summary, caveat: result.kept.length ? `Changed again since, kept as they are: ${result.kept.join(', ')}.` : undefined };
  }

  if (entry.tool === 'wh_capture_map_version' && entry.before && typeof entry.before === 'object' && '__mapVersionCapture' in entry.before) {
    const receipt = (entry.before as { __mapVersionCapture: { mapId: string; versionId: string; fingerprint?: string } }).__mapVersionCapture;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { deleteMapVersion } = await import('@/engines/maps/operations');
    // An era renamed, redated or relinked since it was saved is someone's later work: refuse.
    try { await deleteMapVersion(receipt.mapId, receipt.versionId, scope, receipt.fingerprint); }
    catch (error) { throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error)); }
    return { undone: true, kind, entityId: receipt.mapId, what: summary };
  }

  if ((entry.tool === 'wh_add_map_feature' || entry.tool === 'wh_update_map_feature') && entry.before && typeof entry.before === 'object' && '__mapFeatures' in entry.before) {
    const receipt = (entry.before as { __mapFeatures: { mapId: string; before: import('@/types').MapFeature[]; after: import('@/types').MapFeature[] } }).__mapFeatures;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { scopedTableOps } = await import('@/services/worldEras/tableOps');
    const { worldMapOps } = await import('@/engines/maps/operations');
    const ops = scopedTableOps(scope, 'worldMaps', 'projectId', worldMapOps);
    const map = await ops.getOne(receipt.mapId);
    if (!map) throw new BridgeError('not-found', 'That map no longer exists.');
    // Shapes changed since by hand or by another call are someone's later work: refuse rather than lose them.
    if (JSON.stringify(map.features ?? []) !== JSON.stringify(receipt.after)) throw new BridgeError('cannot-undo', 'The shapes on this map changed after this edit; undo them in the map editor instead.');
    await ops.update(receipt.mapId, { features: receipt.before, updatedAt: Date.now() });
    return { undone: true, kind, entityId: receipt.mapId, what: summary };
  }

  if (entry.tool === 'wh_change_map_ground' && entry.before && typeof entry.before === 'object' && '__mapGround' in entry.before) {
    const receipt = (entry.before as { __mapGround: import('@/engines/maps/operations').GroundChangeReceipt }).__mapGround;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { undoMapGround } = await import('@/engines/maps/operations');
    // The image, shapes or pins edited since are someone's later work: refuse.
    try { await undoMapGround(receipt, scope); }
    catch (error) { throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error)); }
    return { undone: true, kind, entityId: receipt.mapId, what: summary };
  }

  if (entry.tool === 'wh_set_map_scale' && entry.before && typeof entry.before === 'object' && '__mapScale' in entry.before) {
    const receipt = (entry.before as { __mapScale: import('@/engines/maps/operations').MapScaleReceipt }).__mapScale;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { undoMapScale } = await import('@/engines/maps/operations');
    // A scale set again since is someone's later choice: refuse.
    try { await undoMapScale(receipt, scope); }
    catch (error) { throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error)); }
    return { undone: true, kind, entityId: receipt.mapId, what: summary };
  }

  if (entry.tool === 'wh_set_map_layers' && entry.before && typeof entry.before === 'object' && '__mapLayers' in entry.before) {
    const receipt = (entry.before as { __mapLayers: import('@/engines/maps/operations').MapLayersReceipt }).__mapLayers;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { undoMapLayers } = await import('@/engines/maps/operations');
    try { await undoMapLayers(receipt, scope); }
    catch (error) { throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error)); }
    return { undone: true, kind, entityId: receipt.mapId, what: summary };
  }

  if ((entry.tool === 'wh_map_reveal' || entry.tool === 'wh_map_party') && entry.before && typeof entry.before === 'object' && '__mapExploration' in entry.before) {
    const receipt = (entry.before as { __mapExploration: import('@/engines/maps/operations').MapExplorationReceipt }).__mapExploration;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { undoMapExploration } = await import('@/engines/maps/operations');
    // Fog or party changed again since is someone's later work: refuse.
    try { await undoMapExploration(receipt, scope); }
    catch (error) { throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error)); }
    return { undone: true, kind, entityId: receipt.mapId, what: summary };
  }

  if (entry.tool === 'wh_map_artwork' && entry.before && typeof entry.before === 'object' && '__mapArtwork' in entry.before) {
    const receipt = (entry.before as { __mapArtwork: import('@/engines/maps/operations').MapArtworkReceipt }).__mapArtwork;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { undoMapArtwork } = await import('@/engines/maps/operations');
    // Artwork edited again since is someone's later choice: refuse.
    try { await undoMapArtwork(receipt, scope); }
    catch (error) { throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error)); }
    return { undone: true, kind, entityId: receipt.mapId, what: summary };
  }

  if (entry.tool === 'wh_name_map_pins_from_key' && entry.before && typeof entry.before === 'object' && '__mapPinNames' in entry.before) {
    const receipt = (entry.before as { __mapPinNames: { mapId: string; renames: import('@/engines/maps/operations').MapPinRename[] } }).__mapPinNames;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { undoRenameMapPins } = await import('@/engines/maps/operations');
    let restored: import('@/engines/maps/operations').MapPinRename[];
    try { restored = await undoRenameMapPins(receipt.mapId, receipt.renames, scope); }
    catch (error) { throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error)); }
    // Pins renamed again (or gone) since keep their newer name; none left to restore means nothing was undone.
    if (!restored.length) throw new BridgeError('cannot-undo', 'Every pin named by this call has been renamed or removed since; nothing was changed.');
    const kept = receipt.renames.length - restored.length;
    return { undone: true, kind, entityId: receipt.mapId, what: summary, caveat: kept ? `${kept} pin${kept === 1 ? '' : 's'} renamed again or removed since, left as they are.` : undefined };
  }

  if (entry.tool === 'wh_link_map_version' && entry.before && typeof entry.before === 'object' && '__mapVersionLink' in entry.before) {
    const receipt = (entry.before as { __mapVersionLink: { mapId: string; versionId: string; from: string | null; to: string | null; stamped?: string } }).__mapVersionLink;
    const scope = typeof entry.projectId === 'string' && typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined;
    const { linkMapVersion } = await import('@/engines/maps/operations');
    try { await linkMapVersion(receipt.mapId, receipt.versionId, receipt.from, scope, receipt.to, { clearDate: receipt.stamped || undefined }); }
    catch (error) { throw new BridgeError('cannot-undo', error instanceof Error ? error.message : String(error)); }
    return { undone: true, kind, entityId: receipt.mapId, what: summary };
  }

  if (entry.tool === 'wh_project_duplicate' && entry.before && typeof entry.before === 'object') {
    const operationId = (entry.before as Record<string, unknown>).__projectDuplicateOperation;
    if (typeof operationId !== 'string') throw new BridgeError('cannot-undo', 'Project duplicate receipt is missing.');
    const { undoProjectDuplicate } = await import('@/services/projectDuplicate/service');
    const result = await undoProjectDuplicate(operationId);
    return { undone: result.undone, kind, entityId: result.projectId, what: summary, caveat: result.unfinished.length ? result.unfinished.join('; ') : undefined };
  }

  if (entry.tool === 'wh_create_codex_entry' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object' && '__workspaceCodexCreation' in entry.before) {
    const {undoLibraryCodexCreation}=await import('@/components/project/workspace/library/createCodex');
    await undoLibraryCodexCreation({projectId:entry.projectId,eraId:typeof entry.eraId==='string'?entry.eraId:undefined},(entry.before as {__workspaceCodexCreation:import('@/components/project/workspace/library/createCodex').LibraryCodexCreation}).__workspaceCodexCreation);
    return {undone:true,kind,entityId,what:summary};
  }

  if (['wh_writing_tool_dock_apply', 'wh_writing_tool_dock_block_apply'].includes(String(entry.tool)) && entry.before && typeof entry.before === 'object') {
    const before = entry.before as Record<string, unknown>, owner = before.owner as Record<string, unknown> | undefined;
    if (typeof before.__writingToolDockReceipt !== 'string' || typeof entry.projectId !== 'string' || !owner ||
      (owner.kind !== 'project' && (owner.kind !== 'writings' || typeof owner.documentId !== 'string' || !owner.documentId))) {
      throw new BridgeError('cannot-undo', 'This writing tool dock edit has no valid owner and receipt.');
    }
    const { reverseWritingToolDock } = await import('@/engines/writings/toolDock/store');
    await reverseWritingToolDock({ projectId: entry.projectId, eraId: typeof entry.eraId === 'string' ? entry.eraId : undefined },
      owner.kind === 'project' ? { kind: 'project' } : { kind: 'writings', documentId: owner.documentId as string }, before.__writingToolDockReceipt, 'undo');
    return { undone: true, kind, entityId, what: summary };
  }

  if (entry.tool === 'wh_world_folder_import_apply' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object') {
    const receiptId = (entry.before as Record<string, unknown>).__worldFolderImportReceipt;
    if (typeof receiptId === 'string') {
      const {undoWorldFolderImport} = await import('@/services/worldFolderImport/persist');
      const result = await undoWorldFolderImport({projectId:entry.projectId,eraId:typeof entry.eraId==='string'?entry.eraId:undefined},receiptId);
      return {undone:true,kind,entityId,entityIds:result.removed.map(ref=>ref.id),what:summary};
    }
  }

  if(entry.tool==='wh_project_pin_set'&&typeof entry.projectId==='string'&&entry.before&&typeof entry.before==='object'){
    const change=(entry.before as Record<string,unknown>).__projectPin as {from:unknown;to:unknown}|undefined;
    if(!change||typeof change.from!=='boolean'||typeof change.to!=='boolean')throw new BridgeError('cannot-undo','Project pin receipt is missing.');
    const {setProjectPinned}=await import('@/services/projectPin/store');await setProjectPinned(entry.projectId,change.from,change.to);
    return{undone:true,kind,entityId:entry.projectId,what:summary};
  }

  if (entry.tool === 'wh_board_canvas_action' && entry.before && typeof entry.before === 'object') {
    const receiptId = (entry.before as Record<string, unknown>).__boardCanvasReceipt;
    if (typeof receiptId === 'string' && typeof entry.projectId === 'string') {
      const { undoCanvasAction } = await import('@/engines/board/canvasUndo');
      const restored = await undoCanvasAction({ projectId: entry.projectId, eraId: typeof entry.eraId === 'string' ? entry.eraId : undefined }, receiptId);
      return { undone: true, kind: 'update', entityId: restored.boardId, what: summary };
    }
  }

  if (['wh_sheet_update', 'wh_sheet_ink_action', 'wh_sheet_coc_action', 'wh_sheet_daggerheart_action', 'wh_sheet_5e_action'].includes(String(entry.tool)) && entry.before && typeof entry.before === 'object') {
    const receiptId = (entry.before as Record<string, unknown>).__sheetReceipt;
    if (typeof receiptId === 'string' && typeof entry.projectId === 'string') {
      const { undoSheetChange } = await import('@/engines/character-sheets/sheetUndo');
      const id = await undoSheetChange({ projectId: entry.projectId, eraId: typeof entry.eraId === 'string' ? entry.eraId : undefined }, receiptId);
      return { undone: true, kind, entityId: id, what: summary };
    }
  }

  if (entry.tool === 'wh_relation_tree_action' && entry.before && typeof entry.before === 'object') {
    const receiptId = (entry.before as Record<string, unknown>).__treeReceipt;
    if (typeof receiptId === 'string' && typeof entry.projectId === 'string') {
      const { undoTreeAction } = await import('@/engines/genealogy/treeUndo');
      const id = await undoTreeAction({ projectId: entry.projectId, eraId: typeof entry.eraId === 'string' ? entry.eraId : undefined }, receiptId);
      return { undone: true, kind, entityId: id, what: summary };
    }
  }

  if (['wh_local_tool_block_insert','wh_local_tool_block_apply','wh_local_tool_block_remove'].includes(String(entry.tool)) && entry.before && typeof entry.before === 'object') {
    const before=entry.before as Record<string,unknown>,owner=before.owner as Record<string,unknown>|undefined;
    if(typeof before.__localToolBlockReceipt!=='string'||typeof entry.projectId!=='string'||!owner||!['codex','writings'].includes(String(owner.kind))||typeof owner.documentId!=='string'||!owner.documentId)throw new BridgeError('cannot-undo','This source block edit has no valid owner and receipt.');
    const {reverseLocalToolBlock}=await import('@/engines/local/blocks/operations');
    await reverseLocalToolBlock({projectId:entry.projectId,eraId:typeof entry.eraId==='string'?entry.eraId:undefined},{kind:owner.kind as 'codex'|'writings',documentId:owner.documentId},before.__localToolBlockReceipt,'undo');
    return{undone:true,kind,entityId:owner.documentId,what:summary};
  }

  if (entry.tool === 'wh_update_project_details' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object') {
    const before = (entry.before as Record<string, unknown>).__projectDetails as { title?: unknown; description?: unknown; author?: unknown; blurb?: unknown } | undefined;
    if (!before || typeof before.title !== 'string') throw new BridgeError('cannot-undo', 'This change did not record the details before it.');
    await db.projects.update(entry.projectId, { title: before.title, description: typeof before.description === 'string' ? before.description : '', author: typeof before.author === 'string' ? before.author : undefined, blurb: typeof before.blurb === 'string' ? before.blurb : undefined, updatedAt: Date.now() });
    const { notifyProjectsChanged } = await import('@/db/operations');
    notifyProjectsChanged();
    return { undone: true, kind, entityId, what: summary };
  }
  // An encounter goes back to how it was (or away, if the change made it).
  if (entry.before && typeof entry.before === 'object' && '__encounter' in (entry.before as Record<string, unknown>)) {
    const recorded = entry.before as { __encounter: import('@/engines/encounters/model').Encounter | null; __encounterId: string };
    const { restoreEncounter, listEncounters } = await import('@/engines/encounters/operations');
    const nowEncounter = (await listEncounters(String(entry.projectId))).find(item => item.id === recorded.__encounterId);
    assertUnchangedSince(entry.before as Record<string, unknown>, { revision: nowEncounter?.revision, stamp: encounterStamp(nowEncounter) }, 'encounter');
    await restoreEncounter(String(entry.projectId), recorded.__encounter, recorded.__encounterId);
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.before && typeof entry.before === 'object' && '__graphSettings' in (entry.before as Record<string, unknown>)) {
    const recorded = (entry.before as { __graphSettings: { display: import('@/engines/codex/worldGraph/types').WorldGraphDisplay | null; hiddenIds: string[]; views: import('@/engines/codex/worldGraph/types').WorldGraphView[] } }).__graphSettings;
    const { db: database } = await import('@/db');
    const graphProjectId = String(entry.projectId);
    assertUnchangedSince(entry.before as Record<string, unknown>, { stamp: graphStamp((await database.projects.get(graphProjectId))?.codexGraphLayout ?? {}) }, 'graph settings');
    await database.transaction('rw', database.projects, async () => { const project = await database.projects.get(graphProjectId); if (!project) return; const layout = { ...(project.codexGraphLayout ?? { positions: {} }), hiddenIds: recorded.hiddenIds, views: recorded.views }; if (recorded.display) layout.display = recorded.display; else delete layout.display; await database.projects.update(graphProjectId, { codexGraphLayout: layout, updatedAt: Date.now() }); });
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.before && typeof entry.before === 'object' && '__soundscapes' in (entry.before as Record<string, unknown>)) {
    const { restoreSoundscapes, readSoundscapes } = await import('@/engines/soundscape/operations');
    const nowSoundscapes = await readSoundscapes(String(entry.projectId));
    assertUnchangedSince(entry.before as Record<string, unknown>, { revision: nowSoundscapes.revision, stamp: soundscapesStamp(nowSoundscapes) }, 'soundscapes');
    await restoreSoundscapes(String(entry.projectId), (entry.before as { __soundscapes: import('@/engines/soundscape/model').SoundscapeList }).__soundscapes);
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.before && typeof entry.before === 'object' && '__kanbans' in (entry.before as Record<string, unknown>)) {
    const { restoreKanbans, readKanbans } = await import('@/engines/kanban/operations');
    const nowKanbans = await readKanbans(String(entry.projectId));
    assertUnchangedSince(entry.before as Record<string, unknown>, { revision: nowKanbans.revision, stamp: kanbansStamp(nowKanbans) }, 'kanban boards');
    await restoreKanbans(String(entry.projectId), (entry.before as { __kanbans: import('@/engines/kanban/model').KanbanList }).__kanbans);
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.before && typeof entry.before === 'object' && '__tableRules' in (entry.before as Record<string, unknown>)) {
    const { restoreTableRules, readTableRules } = await import('@/engines/character-sheets/tableRulesOperations');
    const nowRules = await readTableRules(String(entry.projectId));
    assertUnchangedSince(entry.before as Record<string, unknown>, { revision: nowRules.revision, stamp: tableRulesStamp(nowRules) }, 'table rules');
    await restoreTableRules(String(entry.projectId), (entry.before as { __tableRules: import('@/engines/character-sheets/tableRules').TableRules }).__tableRules);
    return { undone: true, kind, entityId, what: summary };
  }
  // Reveals go back as they were, unless the card changed since: later work is never overwritten.
  if (entry.before && typeof entry.before === 'object' && '__codexRevealed' in (entry.before as Record<string, unknown>) && typeof entry.projectId === 'string') {
    const recorded = (entry.before as { __codexRevealed: { eraId: string | null; changes: import('@/engines/codex/reveal').RevealChange[] } }).__codexRevealed;
    const { restoreCodexRevealed, RevealConflict } = await import('@/engines/codex/reveal');
    try { await restoreCodexRevealed({ projectId: entry.projectId, eraId: recorded.eraId ?? undefined }, recorded.changes); }
    catch (error) {
      if (error instanceof RevealConflict) throw new BridgeError('cannot-undo', `${error.message} Change it by hand instead.`);
      throw error;
    }
    return { undone: true, kind, entityId, entityIds: recorded.changes.map(change => change.id), what: summary };
  }
  if (entry.before && typeof entry.before === 'object' && '__todos' in (entry.before as Record<string, unknown>)) {
    const { restoreTodos, readTodos } = await import('@/engines/todos/operations');
    const nowTodos = await readTodos(String(entry.projectId));
    assertUnchangedSince(entry.before as Record<string, unknown>, { revision: nowTodos.revision, stamp: todosStamp(nowTodos) }, 'task list');
    await restoreTodos(String(entry.projectId), (entry.before as { __todos: import('@/engines/todos/model').TodoList }).__todos);
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.before && typeof entry.before === 'object' && '__workspaceThemes' in (entry.before as Record<string, unknown>)) {
    const { restoreThemeLibrary, undoThemeDelta } = await import('@/services/workspaceAppearance/themeLibrary');
    const recorded = (entry.before as { __workspaceThemes: import('@/services/workspaceAppearance/themeLibrary').ThemeDeltaReceipt & import('@/services/workspaceAppearance/themeLibrary').ThemeLibraryReceipt }).__workspaceThemes;
    // Refused (never forced) when the library was changed after this entry, or when a deleted theme's picture is no longer kept.
    try { if ('op' in recorded) await undoThemeDelta(recorded); else await restoreThemeLibrary(recorded); }
    catch { throw new BridgeError('cannot-undo', 'The theme library changed after this entry (or its picture is no longer kept); undo it by hand in Appearance.'); }
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.before && typeof entry.before === 'object' && '__workspaceAppearanceReplace' in (entry.before as Record<string, unknown>) && typeof entry.projectId === 'string') {
    const { undoAppearanceReplace } = await import('@/services/workspaceAppearance/themeLibrary');
    const recorded = (entry.before as { __workspaceAppearanceReplace: import('@/services/workspaceAppearance/themeLibrary').AppearanceReplaceReceipt }).__workspaceAppearanceReplace;
    // Refused (never forced) when the appearance was saved again after the theme was applied, or its previous picture is no longer kept.
    try { await undoAppearanceReplace(entry.projectId, recorded); }
    catch { throw new BridgeError('cannot-undo', 'The appearance changed after this theme was applied (or its previous picture is no longer kept); restore it by hand in Appearance.'); }
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.before && typeof entry.before === 'object' && '__diceTray' in (entry.before as Record<string, unknown>)) {
    const { restoreDiceTray, readDiceTray } = await import('@/engines/dice/operations');
    assertUnchangedSince(entry.before as Record<string, unknown>, { stamp: diceStamp(await readDiceTray(String(entry.projectId))) }, 'dice tray');
    await restoreDiceTray(String(entry.projectId), (entry.before as { __diceTray: import('@/engines/dice/operations').DiceTray }).__diceTray);
    return { undone: true, kind, entityId, what: summary };
  }
  // A calendar saved with "re-date": the calendar and the moved events both go back.
  if (entry.tool === 'wh_world_calendar_set' && entry.before && typeof entry.before === 'object' && '__calendarRedate' in (entry.before as Record<string, unknown>)) {
    const recorded = (entry.before as Record<string, unknown>).__calendarRedate as { worldCalendar: import('@/engines/timeline/worldCalendar').WorldCalendar | null; events: { id: string; worldDate?: unknown; worldDateEnd?: unknown; time?: string; endTime?: string; date: string }[]; eraId: string | null };
    const { saveWorldCalendar } = await import('@/engines/timeline/worldCalendarStore');
    const { applyRedate } = await import('@/engines/timeline/redate');
    await saveWorldCalendar(String(entry.projectId), recorded.worldCalendar, recorded.eraId ?? undefined);
    await applyRedate(String(entry.projectId), recorded.events.map(event => ({ id: event.id, title: '', before: '', after: '', changes: { worldDate: event.worldDate, worldDateEnd: event.worldDateEnd, time: event.time, endTime: event.endTime, date: event.date } as never })), recorded.eraId ?? undefined);
    return { undone: true, kind, entityId, what: summary };
  }
  // A timeline's settings go back as they were.
  if (entry.tool === 'wh_timeline_settings' && entry.before && typeof entry.before === 'object' && '__timelineSettings' in (entry.before as Record<string, unknown>)) {
    const before = (entry.before as Record<string, unknown>).__timelineSettings as { title: string; color: string; description: string | null; displayPrecision: string | null; yearRange: { start: number; end: number } | null };
    const recordedEra = (entry.before as Record<string, unknown>).__eraId ?? entry.eraId;
    const { restoreTimelineSettings } = await import('./tools/timeline');
    await restoreTimelineSettings(String(entry.projectId), typeof recordedEra === 'string' ? recordedEra : undefined, entityId, before);
    return { undone: true, kind, entityId, what: summary };
  }
  // A publishing profile goes back to what it was, or away if the bridge made it.
  if (entry.tool === 'wh_publishing_profile_set' && entry.before && typeof entry.before === 'object' && '__publishingProfile' in (entry.before as Record<string, unknown>)) {
    const recorded = entry.before as Record<string, unknown>;
    const previous = recorded.__publishingProfile as PublishingProfile | null;
    const id = recorded.__publishingProfileId;
    if (previous) await db.publishingProfiles.put(previous);
    else if (typeof id === 'string') await db.publishingProfiles.delete(id);
    return { undone: true, kind, entityId, what: summary };
  }
  // Genre types added to the Codex: the ones not edited since go away again.
  if (entry.tool === 'wh_codex_seed_genre_types' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object') {
    const ids = (entry.before as Record<string, unknown>).__seededTemplateIds;
    if (!Array.isArray(ids)) throw new BridgeError('cannot-undo', 'This seeding did not record the types it added.');
    const { deleteCodexTemplate } = await import('@/engines/codex/templates');
    const templates = (await db.projects.get(entry.projectId))?.codexTemplates ?? [];
    for (const template of templates) if (ids.includes(template.id) && template.revision === 1) await deleteCodexTemplate(entry.projectId, template.id, template.revision);
    return { undone: true, kind, entityId, what: summary };
  }
  // A tag renamed or removed on several timeline events: their tags go back.
  if (entry.tool === 'wh_timeline_tags' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object' && '__eventTags' in entry.before) {
    const rows = (entry.before as Record<string, unknown>).__eventTags;
    if (!Array.isArray(rows)) throw new BridgeError('cannot-undo', 'This tag change did not record the tags before it.');
    const { restoreEventTags } = await import('./tools/timeline');
    await restoreEventTags({ projectId: entry.projectId, ...(typeof entry.eraId === 'string' ? { eraId: entry.eraId } : {}) }, rows.filter((row): row is { id: string; tags: string[] } => !!row && typeof (row as { id?: unknown }).id === 'string' && Array.isArray((row as { tags?: unknown }).tags)));
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.tool === 'wh_timeline_tags' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object' && '__timelineTagColors' in entry.before) {
    const colors = (entry.before as Record<string, unknown>).__timelineTagColors as Record<string, string>;
    await db.projects.update(entry.projectId, { timelineTagColors: colors && Object.keys(colors).length ? colors : undefined, updatedAt: Date.now() });
    return { undone: true, kind, entityId, what: summary };
  }
  if (entry.tool === 'wh_timeline_views' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object') {
    const views = (entry.before as Record<string, unknown>).__timelineViews;
    if (!Array.isArray(views)) throw new BridgeError('cannot-undo', 'This view change did not record the views before it.');
    await db.projects.update(entry.projectId, { timelineViews: views.length ? views as never : undefined, updatedAt: Date.now() });
    return { undone: true, kind, entityId, what: summary };
  }
  // A chapter moved in the manuscript renumbered several chapters: they all go back.
  if (entry.tool === 'wh_move_chapter' && typeof entry.projectId === 'string' && entry.before && typeof entry.before === 'object') {
    const chapters = (entry.before as Record<string, unknown>).__chapters;
    if (!Array.isArray(chapters)) throw new BridgeError('cannot-undo', 'This chapter move did not record the numbers before it.');
    const plan = chapters.filter((row): row is { id: string; chapter: number } => !!row && typeof (row as { id?: unknown }).id === 'string' && typeof (row as { chapter?: unknown }).chapter === 'number');
    const { applyChapterNumbers } = await import('@/engines/writings/chapterOrderPersist');
    await applyChapterNumbers(entry.projectId, plan, typeof entry.eraId === 'string' ? { projectId: entry.projectId, eraId: entry.eraId } : undefined);
    return { undone: true, kind, entityId, what: summary };
  }

  if(entry.tool==='wh_project_genres_set'&&typeof entry.projectId==='string'&&entry.before&&typeof entry.before==='object'){
    const change=(entry.before as Record<string,unknown>).__projectGenres as {from:unknown;to:unknown}|undefined;
    if(!change)throw new BridgeError('cannot-undo','This genre edit has no previous value.');
    const {setProjectGenres}=await import('@/services/projectGenres/store');
    await setProjectGenres(entry.projectId,change.from,change.to);
    return{undone:true,kind,entityId:entry.projectId,what:summary};
  }

  // A session change puts back status, date, note link and the session marker, unless the session moved on since.
  if (entry.tool === 'wh_session_set_status' && entry.before && typeof entry.before === 'object') {
    const { __sessionAfterRevision, __absent, ...fields } = entry.before as Record<string, unknown>;
    delete fields.__sessionBeforeRevision;
    await db.transaction('rw', db.outlines, async () => {
      const outline = await db.outlines.get(entityId);
      if (!outline) throw new BridgeError('not-found', 'That session has since been deleted, so there is nothing to restore it onto.');
      if (typeof __sessionAfterRevision === 'number' && (outline.sessionRevision ?? 0) !== __sessionAfterRevision) {
        throw new BridgeError('cannot-undo', 'The session changed after this edit, so undoing it would lose that later work; change it back by hand instead.');
      }
      // Restoring content is a new revision; never recycle a CAS value.
      const patch: Record<string, unknown> = { ...fields, sessionRevision: (outline.sessionRevision ?? 0) + 1, updatedAt: Date.now() };
      if (Array.isArray(__absent)) for (const key of __absent) if (typeof key === 'string') patch[key] = undefined;
      await db.outlines.update(entityId, patch);
    });
    return { undone: true, kind, entityId, what: summary };
  }

  // Logical IDs intentionally remain the same across eras. The ordinary
  // table lookup below must never turn an era reversal into a Base write.
  if (typeof entry.eraId === 'string') {
    if (typeof entry.projectId !== 'string') throw new BridgeError('cannot-undo', 'This era change has no project scope.');
    const scope = { projectId: entry.projectId, eraId: entry.eraId };
    const tool = String(entry.tool ?? '');
    const knownTables: Record<string, string> = {
      wh_add_map_pin: 'mapPins', wh_update_map_pin: 'mapPins',
      wh_create_board: 'boards', wh_add_board_card: 'boardNodes', wh_update_board_card: 'boardNodes', wh_connect_board_cards: 'boardEdges',
      wh_create_timeline: 'timelines', wh_create_event: 'timelineEvents', wh_update_event: 'timelineEvents', wh_connect_events: 'timelineConnections',
    };
    if (typeof entry.table !== 'string' && knownTables[tool]) entry = { ...entry, table: knownTables[tool] };
    const adapter = typeof entry.table === 'string' ? eraAdapterForTable(entry.table) : undefined;
    const documentKind: EraDocumentKind | undefined = typeof entry.table === 'string' ? eraAdapterForTable(entry.table)?.kind : /codex_entry$/.test(tool) ? 'codex' : /writing(?:_version)?$/.test(tool) || tool === 'wh_import_story_session' ? 'writings' : undefined;
    if (!documentKind) throw new BridgeError('cannot-undo', 'Use this era document’s version history to restore this change.');
    if (kind === 'create') {
      const targets = [...new Set(listed.length ? listed : [entityId])];
      const tableName = typeof entry.table === 'string' ? entry.table : undefined;
      const removed = await db.transaction('rw', db.tables, async () => {
        let count = 0;
        for (const id of targets) {
          if (adapter?.parentField && tableName) {
            if (!await readEraRow(scope, tableName, id)) continue;
            await mutateEraRows(scope, [{ table: tableName, id, remove: true }]);
          } else {
            const current = await readWorldDocument(scope, documentKind, id);
            if (!current) continue;
            await hideEraDocument(scope, documentKind, id, current.version);
          }
          count++;
        }
        return count;
      });
      if (!removed) throw new BridgeError('not-found', 'Those items are no longer visible in this era.');
      return { undone: true, kind, entityId: entityId || targets[0], entityIds: targets, what: summary, caveat: removed < targets.length ? `Removed ${removed} of ${targets.length}; the rest were already absent.` : undefined };
    }
    if (adapter?.parentField && typeof entry.table === 'string') {
      const row = await readEraRow<Record<string, unknown>>(scope, entry.table, entityId);
      if (!row) throw new BridgeError('not-found', 'That item is no longer visible in this era.');
      if (kind === 'update' && entry.before && typeof entry.before === 'object') {
        const { __absent, ...changes } = entry.before as Record<string, unknown>;
        if (Array.isArray(__absent)) for (const key of __absent) if (typeof key === 'string') changes[key] = undefined;
        await mutateEraRows(scope, [{ table: entry.table, id: entityId, changes }]);
      } else throw new BridgeError('cannot-undo', 'This era change did not retain the item fields needed to restore it.');
      return { undone: true, kind, entityId, what: summary };
    }
    const current = await readWorldDocument(scope, documentKind, entityId);
    if (!current) throw new BridgeError('not-found', 'That document is no longer visible in this era.');
    if (kind === 'update' && entry.before && typeof entry.before === 'object') {
      const { __absent, ...fields } = entry.before as Record<string, unknown>;
      const root = { ...current.document.root, ...fields };
      if (Array.isArray(__absent)) for (const key of __absent) if (typeof key === 'string') delete root[key];
      await saveEraDocument(scope, documentKind, { ...current.document, root }, current.version);
    } else throw new BridgeError('cannot-undo', 'This era change did not retain the fields needed to restore it.');
    return { undone: true, kind, entityId, what: summary };
  }

  if (kind === 'create' && entry.tool === 'wh_enrich_codex' && typeof entry.projectId === 'string') {
    // The row this call made is the run's receipt. Undoing means reversing the
    // run (fields, id, source), which it does itself and reports honestly.
    const run = await undoEnrichment(entry.projectId, entityId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new BridgeError(message.startsWith('already_undone') ? 'bad-args' : 'cannot-undo', message.startsWith('already_undone') ? 'That enrichment was already undone.' : `Could not undo the enrichment: ${message}.`);
    });
    const kept = (run.undoNotes ?? []).filter((note) => note.startsWith('kept-') || note === 'citation-kept');
    return {
      undone: true,
      kind,
      entityId,
      what: summary,
      caveat: kept.length ? `Some things were left as they are because they changed since: ${kept.join(', ')}.` : undefined,
    };
  }

  if (kind === 'create' && entry.tool === 'wh_world_from_scheherazade' && typeof entry.projectId === 'string') {
    // An imported world is rows in four tables plus a ledger of the refs it brought in: taking
    // it back forgets those refs too, so the same world can be imported again.
    const { undoWorldImport } = await import('@/services/familyBridge/worldImport');
    const { removed } = await undoWorldImport(entry.projectId, listed.length ? listed : [entityId]);
    if (!removed) throw new BridgeError('not-found', 'It is already gone — nothing left to undo.');
    return {
      undone: true,
      kind,
      entityId: entityId || listed[0],
      what: summary,
      caveat: `Removed the ${removed} record(s) this import created. Records it only updated keep their new content, and nothing was changed in Scheherazade.`,
    };
  }

  if (kind === 'create') {
    const targets = listed.length ? listed : [entityId];
    let removed = 0;
    for (const id of targets) {
      const table = await findTable(id);
      if (!table) continue;
      if (table === 'citations') {
        // A source that claims now rest on is retracted, not removed: deleting it
        // would leave them pointing at nothing.
        const leaning = (await db.inquiryClaims.toArray()).filter((claim) => claim.supports.some((support) => support.citationId === id)).length;
        if (leaning) {
          throw new BridgeError('cannot-undo', `${leaning} investigation claim(s) now rest on this source, so it cannot be removed. Retract it with wh_retract_source instead.`);
        }
      }
      const spec = specForTable(table);
      // Prefer the engine's own delete: it takes the children with it.
      if (spec) await spec.remove(id);
      else await db.table(table).delete(id);
      removed += 1;
    }
    if (!removed) {
      throw new BridgeError('not-found', 'It is already gone — nothing left to undo.');
    }
    return {
      undone: true,
      kind,
      entityId: entityId || targets[0],
      what: summary,
      caveat: removed < targets.length
        ? `Removed ${removed} of the ${targets.length} rows this created; the rest were already gone.`
        : undefined,
    };
  }

  const before = entry.before as Record<string, unknown> | undefined;
  if (!before || typeof before !== 'object') {
    throw new BridgeError(
      'cannot-undo',
      'That entry did not record what the row looked like before, so there is nothing to restore.',
    );
  }

  if (kind === 'update') {
    const table = await findTable(entityId);
    if (!table) {
      throw new BridgeError('not-found', 'That row has since been deleted, so there is nothing to restore it onto.');
    }
    // `__absent` lists fields the row did not have before the change: they are
    // taken away again (a Dexie update with `undefined` deletes the property).
    const { __absent, ...fields } = before;
    const patch: Record<string, unknown> = { ...fields, updatedAt: Date.now() };
    const removedKeys = Array.isArray(__absent) ? __absent.filter((key): key is string => typeof key === 'string') : [];
    for (const key of removedKeys) patch[key] = undefined;
    await db.table(table).update(entityId, patch);
    const restored = [...Object.keys(fields), ...removedKeys].join(', ');
    return {
      undone: true,
      kind,
      entityId,
      what: summary,
      // The log keeps the fields a handler thought were worth recording, not
      // the whole row, so say which ones actually went back.
      caveat: `Restored: ${restored}. Any other field the change touched was not recorded and stays as it is.`,
    };
  }

  if (kind === 'delete') {
    const table = typeof entry.table === 'string' ? entry.table : null;
    if (!table) {
      throw new BridgeError('cannot-undo', 'That deletion did not record which table the row came from.');
    }
    if (await db.table(table).get(entityId)) {
      throw new BridgeError('bad-args', 'It is already back — nothing to undo.');
    }
    await db.table(table).put(before);
    return {
      undone: true,
      kind,
      entityId,
      what: summary,
      caveat: 'The row itself is back. Anything that was deleted along with it is not: those rows were never recorded.',
    };
  }

  throw new BridgeError('cannot-undo', `Entries of kind "${kind || 'unknown'}" cannot be undone.`);
}
