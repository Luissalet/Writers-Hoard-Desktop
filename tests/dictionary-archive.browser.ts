import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { WorldDictionary } from '@/engines/dictionary/types';
import type { Project } from '@/types';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { applyProjectScope, validateToolArgs } from '@/services/aiRuntime/toolPolicy';
import { useAppStore } from '@/stores/appStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** The public bridge must archive the embedded language, not its Project row. */
export async function testDictionaryArchive(): Promise<string[]> {
  const projectId = `dictionary-archive-${crypto.randomUUID()}`;
  const otherId = `${projectId}-other`;
  const now = Date.now();
  const passed: string[] = [];
  const project = (id: string): Project => ({ id, title: 'Own dictionary archive fixture', description: 'Keep project prose', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['dictionary', 'archive'], createdAt: now, updatedAt: now } as Project);
  try {
    await db.projects.bulkAdd([project(projectId), project(otherId)]);
    const created = await runBridgeTool('wh_dictionary_create', { projectId, name: 'Own archive language', scriptMapping: 'a=ᚨ\nl=ⵍ\nm=ⵎ' });
    assert(created.ok, `Existing public creation failed: ${JSON.stringify(created)}`);
    const { dictionary, version } = created.result as { dictionary: WorldDictionary; version: string };
    const sibling = await runBridgeTool('wh_dictionary_create', { projectId, name: 'Keep sibling' });
    assert(sibling.ok, `Existing sibling creation failed: ${JSON.stringify(sibling)}`);
    const before = JSON.stringify({ project: await db.projects.get(projectId), other: await db.projects.get(otherId), archives: await db.documentArchives.where('projectId').equals(projectId).toArray() });
    const archived = await runBridgeTool('wh_dictionary_archive', { projectId, dictionaryId: dictionary.id, expectedVersion: version });
    if (!archived.ok) {
      const after = JSON.stringify({ project: await db.projects.get(projectId), other: await db.projects.get(otherId), archives: await db.documentArchives.where('projectId').equals(projectId).toArray() });
      assert(after === before, 'The failed public archive call changed product data');
    }
    assert(archived.ok, `Expected the public bridge to archive this embedded Base dictionary; got ${JSON.stringify(archived)}`);
    const result = archived.result as { archived?: boolean; archiveId?: string };
    assert(result.archived === true && typeof result.archiveId === 'string', 'Archive must return its exact durable receipt');
    const stored = await db.documentArchives.get(result.archiveId);
    assert(stored?.projectId === projectId && stored.kind === 'dictionary' && stored.sourceId === dictionary.id, 'Receipt is not this project/language archive');
    assert(JSON.stringify(stored.metadata?.item) === JSON.stringify(dictionary), 'Archive did not retain the complete language payload');
    assert(!(await db.projects.get(projectId))!.dictionaries?.some(item => item.id === dictionary.id), 'Archived language remains active');
    assert((await db.projects.get(projectId))!.dictionaries?.length === 1, 'Archiving removed the sibling language');
    passed.push('Public Base language archive resolves embedded identity and leaves the complete recoverable payload');
    const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => { const reply = await runBridgeTool(name, args); assert(reply.ok, `${name}: ${JSON.stringify(reply)}`); return reply.result as Record<string, unknown>; };
    const read = async () => await call('wh_dictionary_get', { projectId, dictionaryId: dictionary.id }) as { dictionary: WorldDictionary; version: string };
    const state = async () => JSON.stringify({ projects: await db.projects.bulkGet([projectId, otherId]), archives: await db.documentArchives.where('projectId').anyOf([projectId, otherId]).toArray(), variants: await db.worldEraVariants.where('projectId').equals(projectId).toArray(), writings: await db.writings.where('projectId').equals(projectId).toArray() });
    const refuse = async (args: Record<string, unknown>, code?: string) => { const before = await state(); const reply = await runBridgeTool('wh_dictionary_archive', args); assert(!reply.ok && (!code || reply.code === code), `Expected refusal: ${JSON.stringify(reply)}`); assert(await state() === before, 'Refused archive changed stored data'); return reply; };
    const restore = async (archiveId: string) => { const restored = await call('wh_archive_restore', { projectId, ids: [archiveId] }); assert((restored.restored as unknown[]).length === 1 && !(restored.conflicts as unknown[]).length && !await db.documentArchives.get(archiveId), 'Public restore failed or retained consumed receipt'); };
    const archive = async () => { const current = await read(); const result = await call('wh_dictionary_archive', { projectId, dictionaryId: dictionary.id, expectedVersion: current.version }); assert(result.scope === 'base' && result.archived === true && typeof result.archiveId === 'string', 'Result did not name Shared base and its receipt'); const audit = result.__audit as Record<string, unknown>; assert(audit.projectId === projectId && audit.entityId === dictionary.id && audit.kind === 'delete' && Object.keys(audit.before as object).length === 1 && !audit.table, 'Audit recorded a Project snapshot or lost ownership'); return { result, archiveId: result.archiveId, entry: { tool: 'wh_dictionary_archive', ...audit }, snapshot: current.dictionary }; };

    const tool = getBridgeTool('wh_dictionary_archive'); assert(tool?.writes && tool.engineId === 'dictionary', 'Archive is absent from the normal write catalogue');
    assert(validateToolArgs(tool.schema, { projectId, dictionaryId: dictionary.id, expectedVersion: version }).ok, 'Archive schema rejects normal arguments');
    const eraArgs = validateToolArgs(tool.schema, { projectId, dictionaryId: dictionary.id, expectedVersion: version, eraId: 'named-era' });
    assert(eraArgs.ok && eraArgs.args.eraId === 'named-era', 'Normal argument coercion silently dropped the supplied era target');
    assert(!applyProjectScope(tool, { projectId: otherId, dictionaryId: dictionary.id, expectedVersion: version }, { origin: 'copilot', projectId }).ok, 'Existing conversation scope was bypassed');
    passed.push('Catalogue exposes the Base write and keeps existing project scoping; era targets are not accepted');
    await restore(result.archiveId);
    let current = await read();
    await call('wh_dictionary_save_word', { projectId, dictionaryId: dictionary.id, expectedVersion: current.version, word: { word: 'ala', meaning: 'first meaning', examples: 'Keep this authored example', seeAlso: ['ama'] } });
    current = await read();
    await call('wh_dictionary_save_word', { projectId, dictionaryId: dictionary.id, expectedVersion: current.version, word: { word: 'ama', nativeForm: 'Ω', meaning: 'second meaning', senses: [{ partOfSpeech: 'n.', meaning: 'Another meaning', examples: 'Unicode 𐌰🙂' }] } });
    const full = await read();
    await refuse({ projectId, dictionaryId: dictionary.id, expectedVersion: current.version }, 'conflict');
    await refuse({ projectId: otherId, dictionaryId: dictionary.id, expectedVersion: full.version }, 'not-found');
    await refuse({ ...eraArgs.args, expectedVersion: full.version }, 'bad-args');
    await refuse({ projectId, dictionaryId: dictionary.id, expectedVersion: full.version, eraId: null }, 'bad-args');
    passed.push('Stale word version, another project and supplied era/null targets leave all data exact');

    const rejectArchive = () => { throw new Error('Injected dictionary archive failure'); };
    db.documentArchives.hook('creating', rejectArchive);
    try { await refuse({ projectId, dictionaryId: dictionary.id, expectedVersion: full.version }); } finally { db.documentArchives.hook('creating').unsubscribe(rejectArchive); }
    passed.push('An archive write failure rolls back the normal language removal and its receipt atomically');

    const createdEra = await call('wh_world_era_save', { projectId, era: { name: 'Own retained era', description: '' }, expectedRevision: null });
    const eraId = (createdEra.era as { id: string }).id;
    const eraScope = { projectId, eraId, kind: 'dictionary', entityId: dictionary.id };
    const eraRead = await call('wh_world_era_document_get', eraScope);
    await call('wh_world_era_document_hide', { ...eraScope, expectedVersion: eraRead.version });
    const variants = JSON.stringify(await db.worldEraVariants.where('projectId').equals(projectId).toArray());
    const first = await archive();
    assert(JSON.stringify((await db.documentArchives.get(first.archiveId))!.metadata!.item) === JSON.stringify(full.dictionary), 'Full Unicode words/settings/IDs were not archived');
    assert(JSON.stringify(await db.worldEraVariants.where('projectId').equals(projectId).toArray()) === variants, 'Base archive rewrote retained era variants');
    const listed = await call('wh_archive_list', { projectId }); assert((listed.archived as { id: string }[]).some(row => row.id === first.archiveId), 'Normal archive list omitted the exact copy');
    await restore(first.archiveId);
    assert(JSON.stringify((await read()).dictionary) === JSON.stringify(full.dictionary), 'Public archive restore changed IDs, senses, native override or mapping');
    const found = await call('wh_dictionary_search', { projectId }); const words = (found.dictionaries as { id: string; words: { word: string; native: string }[] }[]).find(row => row.id === dictionary.id)!.words;
    assert(words.find(row => row.word === 'ala')!.native === 'ᚨⵍᚨ' && words.find(row => row.word === 'ama')!.native === 'Ω', 'Restored search lost derived spelling or native override');
    const versions = await call('wh_world_era_versions', { projectId, eraId });
    const tombstone = (versions.variants as { entityId: string; revision: number }[]).find(row => row.entityId === dictionary.id)!;
    await call('wh_world_era_document_restore', { ...eraScope, expectedRevision: tombstone.revision, sourceRevision: tombstone.revision });
    const restoredEra = await call('wh_dictionary_get', { projectId, eraId, dictionaryId: dictionary.id });
    assert(JSON.stringify(restoredEra.dictionary) === JSON.stringify(full.dictionary), 'Existing era hide/restore lost its retained language');
    passed.push('Public list/restore retains complete Unicode payload and native search; Base archival preserves existing era recovery');

    const second = await archive();
    const siblingId = (sibling.result as { dictionary: WorldDictionary }).dictionary.id;
    const siblingRead = await call('wh_dictionary_get', { projectId, dictionaryId: siblingId });
    await call('wh_dictionary_settings', { projectId, dictionaryId: siblingId, expectedVersion: siblingRead.version, description: 'Later sibling edit' });
    await db.projects.update(projectId, { description: 'Later project prose' });
    const writingId = `${projectId}-writing`;
    await db.writings.put({ id: writingId, projectId, title: 'Later prose', content: '<p>Keep this later manuscript Ω.</p>', status: 'draft', wordCount: 5, tags: [], createdAt: now, updatedAt: now });
    const siblingBeforeUndo = JSON.stringify((await call('wh_dictionary_get', { projectId, dictionaryId: siblingId })).dictionary);
    const undone = await runBridgeTool('__undo', { entry: second.entry }); assert(undone.ok, JSON.stringify(undone));
    assert(JSON.stringify((await read()).dictionary) === JSON.stringify(full.dictionary) && !await db.documentArchives.get(second.archiveId), 'Audit Undo did not restore exactly this copy');
    assert((await db.projects.get(projectId))!.description === 'Later project prose' && (await db.writings.get(writingId))!.content === '<p>Keep this later manuscript Ω.</p>' && JSON.stringify((await call('wh_dictionary_get', { projectId, dictionaryId: siblingId })).dictionary) === siblingBeforeUndo, 'Audit Undo overwrote later project/manuscript/sibling work');
    passed.push('Undo restores only the archived language and preserves later sibling, project and manuscript prose');

    const third = await archive();
    const replayBefore = await state(); const replay = await runBridgeTool('__undo', { entry: second.entry });
    assert(!replay.ok && replay.code === 'cannot-undo' && await state() === replayBefore && !!await db.documentArchives.get(third.archiveId), 'Consumed Undo fell back to another archive of the same language');
    for (const forged of [{ ...third.entry, projectId: otherId }, { ...third.entry, entityId: siblingId }]) { const before = await state(); const wrong = await runBridgeTool('__undo', { entry: forged }); assert(!wrong.ok && await state() === before, 'Wrong archive owner/entity was restored'); }
    passed.push('Consumed or wrong-owner/entity receipts cannot restore a later or unrelated archive');

    const occupied = { ...full.dictionary, name: 'Later language occupying the same ID' };
    await db.projects.update(projectId, row => { row.dictionaries = [...row.dictionaries ?? [], occupied]; });
    const occupiedBefore = await state(); const conflict = await runBridgeTool('__undo', { entry: third.entry });
    assert(!conflict.ok && await state() === occupiedBefore && !!await db.documentArchives.get(third.archiveId), 'Occupied ID caused partial restore or consumed the copy');
    const publicConflict = await call('wh_archive_restore', { projectId, ids: [third.archiveId] }); assert(!(publicConflict.restored as unknown[]).length && (publicConflict.conflicts as unknown[]).length === 1 && await state() === occupiedBefore, 'Existing public restore did not retain occupied-ID conflict');
    await db.projects.update(projectId, row => { row.dictionaries = row.dictionaries!.filter(item => item.id !== dictionary.id); });
    await restore(third.archiveId);
    passed.push('An occupied language ID preserves newer content and the archived copy; normal retry restores after conflict removal');

    const previousProject = useAppStore.getState().currentProjectId;
    try { useAppStore.setState({ currentProjectId: projectId }); const current = await read(); const implicit = await call('wh_dictionary_archive', { dictionaryId: dictionary.id, expectedVersion: current.version }); assert(implicit.projectId === projectId && implicit.scope === 'base', 'Normal active-project resolution lost owner'); await restore(String(implicit.archiveId)); } finally { useAppStore.setState({ currentProjectId: previousProject }); }
    passed.push('Omitted projectId uses the normal active project without a global dictionary-ID search');
    assert((await db.projects.get(otherId))!.description === 'Keep project prose', 'Another project changed');
    return passed;
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').anyOf([projectId, otherId]).delete();
    await db.projects.bulkDelete([projectId, otherId]);
  }
}
