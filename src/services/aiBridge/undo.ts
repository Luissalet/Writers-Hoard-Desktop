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

import { db } from '@/db';
import { DELETABLE } from './tools/deletion';
import { undoEnrichment } from '@/engines/inquiry/enrichment';
import { BridgeError, type ToolArgs } from './tools/shared';
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

  if(entry.tool==='wh_project_genres_set'&&typeof entry.projectId==='string'&&entry.before&&typeof entry.before==='object'){
    const change=(entry.before as Record<string,unknown>).__projectGenres as {from:unknown;to:unknown}|undefined;
    if(!change)throw new BridgeError('cannot-undo','This genre edit has no previous value.');
    const {setProjectGenres}=await import('@/services/projectGenres/store');
    await setProjectGenres(entry.projectId,change.from,change.to);
    return{undone:true,kind,entityId:entry.projectId,what:summary};
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
