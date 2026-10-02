// Family hand-offs: hoard.world/1 (export, import, never destructive), the Prospero payloads, the four bridge tools.
import { db } from '@/db';
import { BRIDGE_TOOLS, getBridgeTool } from '@/services/aiBridge/manifest';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { BridgeError } from '@/services/aiBridge/tools/shared';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { applyProjectScope, decidePermission, toolRisk, validateToolArgs } from '@/services/aiRuntime/toolPolicy';
import { getSetting, PROJECT_SETTING_PREFIXES } from '@/db/operations';
import { setFamilyTransport } from '@/services/familyBridge/client';
import { durationSeconds } from '@/services/familyBridge/prospero';
import type { FamilyCallRequest, FamilyCallResponse, FamilyRefsRequest } from '@/services/familyBridge/protocol';
import { buildWorldDoc, loadWorldDoc } from '@/services/familyBridge/worldExport';
import { importWorldDoc } from '@/services/familyBridge/worldImport';
import { entryHash } from '@/services/familyBridge/worldMap';
import { MAX_WORLD_ITEMS, WorldDocumentError, digest, refCodex, refProject, refStoryboard, validateWorldDoc, type WorldDoc } from '@/services/familyBridge/worldSchema';
import type { CodexEntry, InspirationImage, Project } from '@/types';
import type { Relationship } from '@/engines/relationships/types';
import type { StoryboardPanel } from '@/engines/storyboard/types';
import fixture from './fixtures/scheherazade-world.json';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

type Out = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const call = async (tool: string, args: Record<string, unknown>): Promise<Out> => (await TOOL_HANDLERS[tool](args)) as Out;
async function codeOf(tool: string, args: Record<string, unknown>): Promise<{ code: string; message: string }> {
  try { await TOOL_HANDLERS[tool](args); return { code: '', message: '' }; } catch (error) {
    if (error instanceof BridgeError) return { code: error.code, message: error.message };
    throw error;
  }
}
/** The audit line the executor would write for a result, as undoAuditEntry reads it. */
function auditLine(tool: string, result: Out): Record<string, unknown> {
  const audit = (result.__audit ?? {}) as Record<string, unknown>;
  const kind = audit.kind === 'create' || audit.kind === 'update' || audit.kind === 'delete' ? audit.kind : 'update';
  return JSON.parse(JSON.stringify({ tool, kind, ...audit }));
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG_B64}`;

function jpegUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3366cc'; ctx.fillRect(0, 0, 16, 16);
  return canvas.toDataURL('image/jpeg');
}

export async function testFamilyExchange(): Promise<string[]> {
  const passed: string[] = [];
  const stamp = Date.now();
  const id = (name: string) => `fam-${name}-${stamp}`;
  const ALL = ['codex', 'relationships', 'timeline', 'storyboard', 'gallery'];
  const project = (pid: string, title: string, engines: string[] = ALL): Project => ({
    id: pid, title, mode: 'novelist', type: 'standalone', color: '#000', description: `About ${title}`, status: 'draft',
    enabledEngines: engines, engineOrder: engines, createdAt: stamp, updatedAt: stamp,
  });
  const entry = (pid: string, eid: string, type: CodexEntry['type'], title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({
    id: eid, projectId: pid, type, title, fields: {}, content: '', tags: [], relations: [], createdAt: stamp + (extra.createdAt ?? 0), updatedAt: stamp, ...extra,
  });
  const F = fixture as unknown as WorldDoc;

  // ---- 1. The revision is Scheherazade's revision --------------------------------------------------------
  assert(digest({ name: 'Ana', aliases: ['la capitana'], summary: 'Capitana del faro', description: 'Alta y seria.\n\nÑu', status: 'alive', tags: ['marina'], fields: { edad: '34', rango: 'capitana' } })
    === 'sha256:c49e787980d112bd87ce23b6d86c2f0afbbf16adae3096bbd56a3d8113fc6273', 'digest of an entity differs from the one Python computes');
  assert(digest({ from: 'hoard://writer/codex/a', to: 'hoard://writer/codex/b', type: 'mentor', note: 'le enseñó', since: '' })
    === 'sha256:5b2a5e85734525bbb0e973c2ea09dcecdb51cd5b8cac95251c15c31a60caa983', 'digest of a relation differs from the one Python computes');
  const sections = ['characters', 'places', 'factions', 'things', 'relations', 'events'] as const;
  let rechecked = 0;
  for (const section of sections) {
    for (const item of F[section] ?? []) {
      const { ref: _ref, revision, same_as: _same, ...body } = item as unknown as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
      assert(digest(body) === revision, `the revision of ${String(_ref)} (made by Scheherazade) is not reproduced here`);
      rechecked += 1;
    }
  }
  assert(rechecked === 11, 'the fixture holds eleven records');
  const { source: _source, world: _world, schema: _schema, ...docBody } = F as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
  assert(digest({ world: F.world, ...docBody }) === F.source?.revision, 'the revision of the whole document is reproduced too');
  passed.push('hoard.world/1: revisions of entities, relations, events and the whole document match the ones Scheherazade (Python) computes');

  // ---- 2. Manifest, policy, risk ---------------------------------------------------------------------------
  const names = ['wh_character_to_prospero', 'wh_storyboard_to_prospero', 'wh_world_to_scheherazade', 'wh_world_from_scheherazade'];
  for (const name of names) {
    const tool = getBridgeTool(name);
    assert(tool, `${name} is missing from the manifest`);
    assert(tool.group === 'story' && tool.writes === true && tool.engineId === undefined, `${name}: group story, writes, no engine`);
    assert(tool.description.split('\n')[0].length <= 110 && tool.description.split('\n').length > 1, `${name}: first line must be a short summary`);
    assert(tool.schema.additionalProperties === false && (tool.schema.required ?? []).every(key => key in tool.schema.properties), `${name}: strict schema`);
    assert('projectId' in tool.schema.properties, `${name} takes projectId`);
    assert(typeof tool.timeoutMs === 'number' && tool.timeoutMs >= 120_000, `${name}: a slow hub call needs a long timeout`);
    assert(typeof TOOL_HANDLERS[name] === 'function', `${name} has no handler`);
    assert(toolRisk(tool) === 'external', `${name} reaches another app, so its risk class is external`);
    assert(decidePermission(tool, { origin: 'copilot', actionPolicy: 'read-only' }, true).allowed === false, `${name} must not run in a read-only conversation`);
    const ask = decidePermission(tool, { origin: 'copilot', actionPolicy: 'ask' }, true);
    assert(ask.allowed && ask.needsApproval, `${name} must ask before sending anything out`);
    assert(decidePermission(tool, { origin: 'bridge' }, false).allowed === false, `${name} follows the bridge's write switch`);
    assert(decidePermission(tool, { origin: 'feature' }, true).allowed === false, `${name} is not available to internal features`);
  }
  assert(BRIDGE_TOOLS.length === new Set(BRIDGE_TOOLS.map(tool => tool.name)).size, 'tool names stay unique');
  const alias = validateToolArgs(getBridgeTool('wh_character_to_prospero')!.schema, { project_id: 'p1', character_id: 'c1', stray: 1 });
  assert(alias.ok && alias.args.projectId === 'p1' && alias.args.characterId === 'c1' && !('stray' in alias.args), 'snake_case argument names are read as their camelCase twins');
  const both = validateToolArgs(getBridgeTool('wh_world_to_scheherazade')!.schema, { projectId: 'exact', project_id: 'alias', world_id: 'W' });
  assert(both.ok && both.args.projectId === 'exact' && both.args.worldId === 'W', 'the exact key wins over its alias');
  assert(!validateToolArgs(getBridgeTool('wh_world_from_scheherazade')!.schema, { project_id: 'p' }).ok, 'a missing required argument is still refused after aliasing');
  const scopeTool = getBridgeTool('wh_world_to_scheherazade')!;
  assert(!applyProjectScope(scopeTool, { projectId: 'other' }, { origin: 'copilot', projectId: 'mine' }).ok, 'a copilot cannot send another project\'s world');
  passed.push('Bridge: four tools in the story group, strict schemas, external risk, ask-before-send, snake_case aliases, scope pin');

  // ---- 3. The document built from a project ----------------------------------------------------------------
  const X = id('x');
  const ana = entry(X, `${X}-ana`, 'character', 'Ana', {
    createdAt: 1, content: '<p>Alta y seria.</p><p>Segunda frase.</p>', tags: ['marina'],
    fields: { role: 'capitana', physicalDescription: 'Alta', aliases: 'Cap, la capitana', status: 'alive', empty: '' },
  });
  const beto = entry(X, `${X}-beto`, 'character', 'Beto', { createdAt: 2, fields: { summary: 'Grumete', status: 'dead' } });
  const rows: CodexEntry[] = [
    ana, beto,
    entry(X, `${X}-faro`, 'location', 'El Faro', { createdAt: 3 }),
    entry(X, `${X}-liga`, 'faction', 'La Liga', { createdAt: 4 }),
    entry(X, `${X}-espada`, 'item', 'Espada', { createdAt: 5 }),
    entry(X, `${X}-idea`, 'concept', 'La Marea', { createdAt: 6 }),
    entry(X, `${X}-magia`, 'magic', 'Hilos', { createdAt: 7 }),
    entry(X, `${X}-kraken`, 'custom', 'Kraken', { createdAt: 8, fields: { kind: 'creature', size: 'huge' } }),
    entry(X, `${X}-otro`, 'custom', 'Otro', { createdAt: 9 }),
    entry(X, `${X}-nameless`, 'item', '   ', { createdAt: 10 }),
    entry(X, `${X}-from`, 'character', 'Zed', { createdAt: 11, familySource: { app: 'scheherazade', ref: 'hoard://scheherazade/entity/e_zed', sameAs: ['hoard://writer/codex/self', 'hoard://other/x/1'], revision: 'sha256:r', localHash: 'h', worldRef: 'hoard://scheherazade/world/w', importedAt: 1 } }),
  ];
  const rel = (rid: string, a: string, b: string, extra: Partial<Relationship> = {}): Relationship => ({
    id: rid, projectId: X, entityAId: a, entityAType: 'codex-entry', entityAName: 'a', entityBId: b, entityBType: 'codex-entry', entityBName: 'b',
    kind: 'mentor', intensity: 3, label: 'su maestra', notes: 'le enseñó', state: 'current', directional: true, createdAt: stamp, updatedAt: stamp, ...extra,
  });
  const relationships = [
    rel(`${X}-r1`, `${X}-ana`, `${X}-beto`),
    rel(`${X}-r2`, `${X}-ana`, `${X}-faro`, { kind: 'other', label: 'guarda', notes: '' }),
    rel(`${X}-r3`, `${X}-ana`, `${X}-liga`, { state: 'secret' }),
    rel(`${X}-r4`, `${X}-ana`, 'gone'),
  ];
  const event = (eid: string, timelineId: string, order: number, title: string, description: string, date: string, linkedEntryId?: string) => ({
    id: eid, projectId: X, timelineId, title, description, date, dateMode: 'text' as const, eventType: 'point' as const, order, lane: '', color: '#fff', linkedEntryId, createdAt: stamp, updatedAt: stamp,
  });
  const timelines = [{ id: 'tl1', projectId: X, title: 'Uno', color: '#fff', createdAt: stamp, updatedAt: stamp }, { id: 'tl2', projectId: X, title: 'Dos', color: '#fff', createdAt: stamp, updatedAt: stamp }];
  const events = [
    event('e3', 'tl2', 0, 'Tercero', '', 'Año 9'),
    event('e2', 'tl1', 1, 'Segundo', 'Algo más largo', 'Año 2', `${X}-ana`),
    event('e1', 'tl1', 0, 'Primero', '', 'Año 1', 'not-exported'),
    event('e0', 'tl1', 2, '', '', 'Año 5'),
  ];
  const built = buildWorldDoc({ project: { id: X, title: 'Mi novela', description: 'Un reino' }, entries: rows, relationships, events, timelines, language: 'en', exportedAt: 1 });
  const doc = built.doc;
  assert(doc.schema === 'hoard.world/1' && doc.source?.app === 'writer' && doc.source.ref === refProject(X) && doc.source.revision?.startsWith('sha256:'), 'the document names this app and project');
  assert(doc.world?.name === 'Mi novela' && doc.world.premise === 'Un reino' && doc.world.language === 'en', 'world metadata comes from the project');
  assert(doc.characters!.length === 3 && doc.places!.length === 1 && doc.factions!.length === 1 && doc.things!.length === 5, 'codex types fall into the right sections');
  assert(built.skipped.unnamedEntries === 1 && !JSON.stringify(doc).includes('nameless'), 'an unnamed entry is left out and counted');
  const exportedAna = doc.characters!.find(item => item.name === 'Ana')!;
  assert(exportedAna.ref === refCodex(`${X}-ana`) && exportedAna.revision === digest({ name: 'Ana', aliases: ['Cap', 'la capitana'], summary: 'Alta y seria.', description: 'Alta y seria.\n\nSegunda frase.', status: 'alive', tags: ['marina'], fields: { role: 'capitana', physicalDescription: 'Alta' } }), 'an entity carries a ref and the revision Scheherazade would compute');
  assert(exportedAna.summary === 'Alta y seria.' && exportedAna.aliases!.join('|') === 'Cap|la capitana' && exportedAna.status === 'alive', 'summary falls back to the first paragraph; aliases and status are lifted out of the sheet');
  assert(!('aliases' in exportedAna.fields!) && !('status' in exportedAna.fields!) && !('empty' in exportedAna.fields!), 'lifted and empty fields are not repeated');
  assert(doc.characters!.find(item => item.name === 'Beto')!.status === 'dead', 'status comes from the sheet');
  assert(doc.characters!.find(item => item.name === 'Zed')!.same_as!.join('|') === 'hoard://scheherazade/entity/e_zed|hoard://other/x/1', 'an imported entry names its other refs (never this app\'s own) as same_as');
  const kinds = Object.fromEntries(doc.things!.map(item => [item.name, item.kind]));
  assert(JSON.stringify(kinds) === JSON.stringify({ Espada: 'item', 'La Marea': 'lore', Hilos: 'lore', Kraken: 'creature', Otro: 'lore' }), `things carry their kind, got ${JSON.stringify(kinds)}`);
  assert(!('kind' in doc.things!.find(item => item.name === 'Kraken')!.fields!) && doc.things!.find(item => item.name === 'Kraken')!.fields!.size === 'huge', 'a creature\'s kind travels as the kind, not as a field');
  assert(doc.relations!.length === 2 && built.skipped.secretRelations === 1 && built.skipped.danglingRelations === 1, 'secret and dangling relationships are left out and counted');
  const mentor = doc.relations![0];
  assert(mentor.type === 'mentor' && mentor.note === 'su maestra\nle enseñó' && mentor.from === refCodex(`${X}-ana`) && mentor.to === refCodex(`${X}-beto`) && mentor.since === '', 'a relationship is a free-text type and a note');
  assert(doc.relations![1].type === 'guarda', 'an "other" relationship uses its label as the type');
  assert(buildWorldDoc({ project: { id: X, title: 'T' }, entries: rows, relationships, events, timelines, includeSecret: true }).doc.relations!.length === 3, 'includeSecret sends secret relationships');
  assert(doc.events!.map(item => item.date).join('|') === 'Año 1|Año 2|Año 9', 'events keep timeline order, and an empty one is left out');
  assert(doc.events![1].summary === 'Segundo — Algo más largo' && doc.events![1].entities!.join() === refCodex(`${X}-ana`) && doc.events![0].entities!.length === 0, 'an event is one line and the entries it touches that are in the document');
  const again = buildWorldDoc({ project: { id: X, title: 'Mi novela', description: 'Un reino' }, entries: rows, relationships, events, timelines, language: 'en', exportedAt: 1 });
  assert(JSON.stringify(again.doc) === JSON.stringify(doc), 'the same project always gives the same document');
  const edited = buildWorldDoc({ project: { id: X, title: 'Mi novela', description: 'Un reino' }, entries: rows.map(row => row.id === `${X}-ana` ? { ...row, content: '<p>Cambiada.</p>' } : row), relationships, events, timelines, language: 'en', exportedAt: 1 });
  assert(edited.doc.characters!.find(item => item.name === 'Ana')!.revision !== exportedAna.revision && edited.doc.characters!.find(item => item.name === 'Beto')!.revision === doc.characters!.find(item => item.name === 'Beto')!.revision, 'editing one entry changes only its revision');
  for (const text of [JSON.stringify(doc)]) assert(!/data:image|avatar|imageData/i.test(text), 'no picture ever goes in the document');
  let tooMany = '';
  try { buildWorldDoc({ project: { id: X, title: 'T' }, entries: Array.from({ length: MAX_WORLD_ITEMS + 1 }, (_, i) => entry(X, `big-${i}`, 'item', `Item ${i}`)), relationships: [], events: [] }); } catch (error) { tooMany = error instanceof WorldDocumentError ? error.message : String(error); }
  assert(/at most 5000/.test(tooMany), 'a project over the limit says so');
  passed.push('World export: sections, kinds, lifted fields, summary fallback, same_as, secret/dangling/empty left out, deterministic, edit-sensitive revisions, no pictures');

  // ---- 4. Import: the rules --------------------------------------------------------------------------------
  const A = id('a');
  await db.projects.add(project(A, 'Proyecto A'));
  const r1 = await importWorldDoc(A, F);
  assert(JSON.stringify(r1.counts) === '{"created":11}', `first import creates everything: ${JSON.stringify(r1.counts)}`);
  assert(r1.created.codex.length === 7 && r1.created.relationships.length === 2 && r1.created.events.length === 2 && r1.created.timelines.length === 1, 'rows made per table');
  const rowsA = await db.codexEntries.where('projectId').equals(A).toArray();
  const byName = (name: string) => rowsA.find(row => row.title === name)!;
  const anaA = byName('Ana');
  assert(anaA.type === 'character' && anaA.fields.summary === 'Capitana del faro' && anaA.fields.aliases === 'la capitana' && anaA.fields.edad === '34' && anaA.fields.rango === 'capitana' && anaA.tags.join() === 'marina', 'fields, aliases, summary and tags land on the entry');
  assert(anaA.content.includes('<strong>farol</strong>') && anaA.content.includes('Alta y seria.'), 'the description becomes rich text');
  assert(byName('Beto').fields.status === 'dead' && byName('El Faro').type === 'location' && byName('La Liga del Mar').type === 'faction' && byName('Espada rota').type === 'item', 'sections become codex types, status becomes a field');
  assert(byName('Kraken').type === 'custom' && byName('Kraken').fields.kind === 'creature' && byName('La Marea Negra').type === 'concept', 'a creature is a custom entry that remembers its kind; lore is a concept');
  assert(anaA.familySource?.ref === 'hoard://scheherazade/entity/e_662d17c9752d' && anaA.familySource.revision === F.characters![0].revision && anaA.familySource.localHash === entryHash(anaA) && anaA.familySource.worldRef === F.source!.ref, 'the receipt keeps ref, revision, a hash of the entry as imported and the world');
  assert(byName('Beto').familySource!.sameAs!.join() === 'hoard://writer/codex/gone_char', 'the source\'s same_as is kept');
  const relsA = await db.relationships.where('projectId').equals(A).toArray();
  const mentorA = relsA.find(row => row.kind === 'mentor')!;
  assert(mentorA.entityAId === anaA.id && mentorA.entityBId === byName('Beto').id && mentorA.entityAName === 'Ana' && mentorA.notes === 'le enseñó a navegar\n(año 3)' && mentorA.directional && mentorA.state === 'current', 'a relation becomes a relationship between the imported entries');
  const memberA = relsA.find(row => row.kind === 'other')!;
  assert(memberA.label === 'miembro' && memberA.entityBId === byName('La Liga del Mar').id, 'a free-text relation type becomes the label of an "other" relationship');
  const timelineA = (await db.timelines.where('projectId').equals(A).toArray())[0];
  const eventsA = await db.timelineEvents.where('projectId').equals(A).toArray();
  assert(timelineA.title === 'Archipiélago (Scheherazade)' && timelineA.familySource?.ref === F.source!.ref && eventsA.length === 2 && eventsA.every(row => row.timelineId === timelineA.id && row.familySource), 'events go on one timeline named after the world');
  const lit = eventsA.find(row => row.title === 'Se enciende el faro')!;
  assert(lit.date === 'Año 1' && lit.linkedEntryId === byName('El Faro').id && lit.order === 0 && eventsA.find(row => row.title === 'Cae el reino')!.order === 1, 'an event keeps its date, the first entry it touches and its order');
  assert((await getSetting(`${PROJECT_SETTING_PREFIXES.familyWorld}${A}`))?.includes('hoard://scheherazade/entity/e_662d17c9752d'), 'the refs brought in are remembered per project');

  const r2 = await importWorldDoc(A, F);
  assert(JSON.stringify(r2.counts) === '{"unchanged":11}' && !r2.created.codex.length && (await db.codexEntries.where('projectId').equals(A).count()) === 7, 'importing again changes nothing');

  const F2 = clone(F);
  F2.characters![0].summary = 'Almirante del faro';
  F2.characters![0].revision = 'sha256:rev2';
  const r3 = await importWorldDoc(A, F2);
  assert(r3.counts.updated === 1 && r3.counts.unchanged === 10 && r3.updatedIds.join() === anaA.id, 'a newer revision of an untouched entry updates it');
  const anaUpdated = (await db.codexEntries.get(anaA.id))!;
  assert(anaUpdated.fields.summary === 'Almirante del faro' && anaUpdated.content.includes('farol') && anaUpdated.familySource!.revision === 'sha256:rev2' && anaUpdated.familySource!.localHash === entryHash(anaUpdated), 'the update lands and the receipt moves with it');

  await db.codexEntries.update(anaA.id, { fields: { ...anaUpdated.fields, edad: '35' } });
  const F3 = clone(F2);
  F3.characters![0].summary = 'Almirante retirada';
  F3.characters![0].revision = 'sha256:rev3';
  const r4 = await importWorldDoc(A, F3);
  const kept = r4.items.find(item => item.state === 'local_modified');
  assert(r4.counts.local_modified === 1 && kept?.name === 'Ana' && /edited here/.test(kept.reason ?? ''), 'an entry the writer edited is reported, not overwritten');
  const anaKept = (await db.codexEntries.get(anaA.id))!;
  assert(anaKept.fields.summary === 'Almirante del faro' && anaKept.fields.edad === '35' && anaKept.familySource!.revision === 'sha256:rev2', 'the edited entry and its receipt are untouched');
  assert((await importWorldDoc(A, F2)).counts.unchanged === 11, 'the same revision as last time is unchanged even for an edited entry');

  const espada = byName('Espada rota');
  await db.codexEntries.delete(espada.id);
  const r5 = await importWorldDoc(A, F);
  const gone = r5.items.find(item => item.name === 'Espada rota')!;
  assert(gone.state === 'skipped' && gone.reason === 'deleted_locally' && !(await db.codexEntries.where('projectId').equals(A).toArray()).some(row => row.title === 'Espada rota'), 'an entry the writer deleted is never brought back');

  // Pre-existing names, own refs, disabled engines.
  const B = id('b');
  await db.projects.add(project(B, 'Proyecto B', ['codex']));
  await db.codexEntries.bulkAdd([
    entry(B, `${B}-faro`, 'location', 'el faro', { content: '<p>mine</p>', createdAt: 1 }),
    entry(B, `${B}-liga`, 'faction', 'LA LIGA DEL MAR', { createdAt: 2 }),
    entry(B, `${B}-kraken`, 'faction', 'Kraken', { createdAt: 3 }),
  ]);
  const rB = await importWorldDoc(B, F, { relationships: false, timeline: false });
  assert(JSON.stringify(rB.counts) === '{"created":4,"linked_existing":2,"name_collision":1,"skipped":4}', `names that exist are linked or reported: ${JSON.stringify(rB.counts)}`);
  const faroB = (await db.codexEntries.get(`${B}-faro`))!;
  assert(faroB.content === '<p>mine</p>' && faroB.title === 'el faro' && faroB.familySource?.ref.endsWith('/entity/' + F.places![0].ref.split('/').pop()) && (await db.codexEntries.where('projectId').equals(B).count()) === 7, 'a linked entry keeps its own words and gets a receipt; nothing is duplicated');
  assert(rB.items.filter(item => item.reason === 'engine_disabled').length === 4 && rB.notes.length === 2 && !(await db.relationships.where('projectId').equals(B).count()) && !(await db.timelines.where('projectId').equals(B).count()), 'relations and events are skipped, and said so, when their engines are off');
  const F5 = clone(F);
  F5.places![0].revision = 'sha256:rev9';
  F5.places![0].summary = 'Otra torre';
  assert((await importWorldDoc(B, F5, { relationships: false, timeline: false })).items.find(item => item.name === 'El Faro')!.state === 'local_modified', 'a linked entry that differs from what the source sent counts as the writer\'s own and is never overwritten');
  assert((await db.codexEntries.get(`${B}-faro`))!.content === '<p>mine</p>', 'and stays as it was');

  const D = id('d');
  await db.projects.add(project(D, 'Proyecto D'));
  await db.codexEntries.add(entry(D, `${D}-beto`, 'character', 'Beto'));
  const F4 = clone(F);
  F4.characters![1].same_as = [`hoard://writer/codex/${D}-beto`];
  const rD = await importWorldDoc(D, F4);
  assert(rD.items.find(item => item.name === 'Beto')!.state === 'own' && rD.counts.created === 10, 'a record that came from this app is recognised and not duplicated');
  assert((await db.relationships.where('projectId').equals(D).toArray()).find(row => row.kind === 'mentor')!.entityBId === `${D}-beto`, 'relations point at the entry it came from');
  assert((await db.codexEntries.where('projectId').equals(D).count()) === 7, 'no duplicate Beto');
  const echo = await loadWorldDoc(D);
  const rEcho = await importWorldDoc(D, echo.doc);
  assert(Object.keys(rEcho.counts).join() === 'own' && !rEcho.created.codex.length, `a document of this app\'s own refs coming back changes nothing: ${JSON.stringify(rEcho.counts)}`);

  const C = id('c');
  await db.projects.add(project(C, 'Proyecto C'));
  const odd: WorldDoc = {
    schema: 'hoard.world/1',
    characters: [
      { ref: 'nope', name: 'No ref' }, { ref: 'hoard://x/y/z', name: '  ' },
      { ref: 'hoard://x/y/zed1', name: 'Zed', fields: { n: 3, flag: true, nested: { a: 1 } } as unknown as Record<string, string>, status: 'zombie', tags: ['a', 'a', ' b '] },
      { ref: 'hoard://x/y/zed2', name: 'zed' },
    ],
    relations: [
      { ref: 'hoard://x/y/r1', from: 'hoard://x/y/zed1', to: 'hoard://x/y/missing', type: 'ally' },
      { ref: 'hoard://x/y/r2', from: 'hoard://x/y/zed1', to: 'hoard://x/y/zed1', type: 'ally' },
      { ref: 'bad', from: 'a', to: 'b', type: 'ally' },
    ],
    events: [{ ref: 'hoard://x/y/e1', summary: '' }, { ref: 'hoard://x/y/e2', summary: 'x'.repeat(250), date: 'd' }],
  };
  const rC = await importWorldDoc(C, odd);
  const reasons = rC.items.map(item => `${item.state}${item.reason ? `:${item.reason}` : ''}`).join(' ');
  assert(reasons === 'skipped:bad_ref skipped:no_name created name_collision:"Zed" was already imported from another record of the document skipped:endpoint_missing skipped:invalid skipped:bad_ref skipped:no_summary created', `unusable records are skipped with a reason, got ${reasons}`);
  const zed = (await db.codexEntries.where('projectId').equals(C).toArray())[0];
  assert(zed.fields.n === '3' && zed.fields.flag === 'true' && zed.fields.nested === '{"a":1}' && !('status' in zed.fields) && zed.tags.join() === 'a,b', 'fields are flattened to text, an unknown status is read as unknown, tags are deduplicated');
  const longEvent = (await db.timelineEvents.where('projectId').equals(C).toArray())[0];
  assert(longEvent.description.length === 250 && longEvent.title.length <= 101 && longEvent.title.endsWith('…'), 'a long event summary keeps its text and gets a short title');
  for (const bad of [null, {}, { schema: 'other/1' }, { schema: 'hoard.world/1', characters: {} }, { schema: 'hoard.world/1', world: 'x' }, { schema: 'hoard.world/1', characters: Array.from({ length: MAX_WORLD_ITEMS + 1 }, () => ({})) }]) {
    let thrown = false;
    try { validateWorldDoc(bad); } catch (error) { thrown = error instanceof WorldDocumentError; }
    assert(thrown, `a document that is not hoard.world/1 must be refused: ${JSON.stringify(bad)?.slice(0, 60)}`);
  }
  passed.push('World import: created / unchanged / updated / local_modified / linked_existing / name_collision / own / skipped (every reason), deleted entries stay deleted, engines off are reported, echo is a no-op');

  // ---- 5. The tools, against a stand-in hub -----------------------------------------------------------------
  const calls: FamilyCallRequest[] = [];
  const links: FamilyRefsRequest[] = [];
  let answer: (request: FamilyCallRequest) => FamilyCallResponse = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true } });
  setFamilyTransport(async request => { calls.push(request); return answer(request); }, async request => { links.push(request); return { ok: true }; });
  try {
    const T = id('t');
    await db.projects.add(project(T, 'Proyecto T'));
    const anaId = `${T}-ana`;
    await db.codexEntries.bulkAdd([
      entry(T, anaId, 'character', 'Ana Ruiz', {
        avatar: jpegUrl(), avatarOriginal: jpegUrl(), content: '<p>Capitana del faro.</p>',
        fields: { role: 'capitana', personality: 'seria', physicalDescription: 'Alta y delgada', hair: 'negro', backstory: 'Nació en el faro', mood: 'cansada' },
      }),
      entry(T, `${T}-faro`, 'location', 'El Faro'),
      entry(T, `${T}-plain`, 'character', 'Sin retrato', { fields: { physical: 'Bajo' } }),
    ]);
    const galleryImage = (gid: string, linked: string[], extra: Partial<InspirationImage> = {}): InspirationImage => ({ id: gid, projectId: T, imageData: PNG_URL, tags: [], notes: '', linkedEntryIds: linked, createdAt: stamp, ...extra });
    await db.inspirationImages.bulkAdd([galleryImage(`${T}-g1`, [anaId]), galleryImage(`${T}-g2`, ['someone-else']), galleryImage(`${T}-g3`, [], { imageData: undefined as unknown as string, thumbnailData: PNG_URL })]);
    const before = JSON.stringify(await db.codexEntries.get(anaId));

    answer = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true, character_id: 'c77' } });
    const sentCharacter = await call('wh_character_to_prospero', { projectId: T, characterId: anaId });
    const cast = calls[0];
    assert(cast.app === 'prospero' && cast.tool === 'cast_import_character', 'the character goes to Prospero\'s cast_import_character');
    const castArgs = cast.args as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert(castArgs.name === 'Ana Ruiz' && castArgs.source_ref === refCodex(anaId), 'name and source_ref are sent');
    assert(castArgs.look === 'Alta y delgada\nHair: negro' && !castArgs.description.includes('Alta y delgada'), `look carries the physical fields: ${JSON.stringify(castArgs.look)}`);
    assert(castArgs.description.includes('Role: capitana') && castArgs.description.includes('Personality: seria') && castArgs.description.includes('Backstory: Nació en el faro') && castArgs.description.includes('Mood: cansada') && castArgs.description.includes('Capitana del faro.'), 'description is built from the sheet and the body');
    assert(castArgs.images.join() === '@file:portrait,@file:gallery-1' && cast.files?.length === 2 && cast.files.every(file => file.base64.startsWith('iVBORw0KGgo')), 'the portrait (a JPEG here) and the linked gallery picture travel as PNGs, other people\'s pictures do not');
    assert(sentCharacter.sent === true && sentCharacter.prospero.id === 'c77' && sentCharacter.prospero.ref === 'hoard://prospero/character/c77' && sentCharacter.pictures.sent === 2 && sentCharacter.linked === true, 'the result says what happened');
    assert(links[0].from === refCodex(anaId) && links[0].to === 'hoard://prospero/character/c77' && links[0].rel === 'sent_to', 'the hub is told the two records are the same');
    assert(JSON.stringify(await db.codexEntries.get(anaId)) === before, 'the codex entry is only read');
    assert((sentCharacter.__audit as Record<string, unknown>).summary === 'sent character "Ana Ruiz" to Prospero\'s cast' && !(sentCharacter.__audit as Record<string, unknown>).entityId, 'the audit line says what was sent and promises no undo');
    await call('wh_character_to_prospero', { project_id: T, character_id: `${T}-plain` });
    const plainArgs = calls[1].args as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert(!('images' in plainArgs) && !calls[1].files && plainArgs.look === 'Bajo', 'a character with no picture sends no images (and snake_case arguments work on a direct call)');
    assert((await codeOf('wh_character_to_prospero', { projectId: T, characterId: `${T}-faro` })).code === 'bad-args', 'a location is not a character');
    assert((await codeOf('wh_character_to_prospero', { projectId: T, characterId: 'nope' })).code === 'not-found', 'an unknown id is not found');
    assert((await codeOf('wh_character_to_prospero', { projectId: T })).code === 'bad-args', 'characterId is required');
    const other = id('other');
    await db.projects.add(project(other, 'Otro'));
    assert((await codeOf('wh_character_to_prospero', { projectId: other, characterId: anaId })).code === 'scope', 'a character of another project is refused');
    const pinned = applyProjectScope(getBridgeTool('wh_character_to_prospero')!, { characterId: anaId }, { origin: 'copilot', projectId: other });
    assert(pinned.ok && (await codeOf('wh_character_to_prospero', pinned.args)).code === 'scope', 'a copilot pinned to another project cannot send this one\'s character');

    // Failures read as instructions.
    const failure = async (code: Extract<FamilyCallResponse, { ok: false }>['code'], error: string) => {
      answer = request => ({ ok: false, code, error, app: request.app, tool: request.tool });
      return codeOf('wh_character_to_prospero', { projectId: T, characterId: anaId });
    };
    const down = await failure('hub_unreachable', 'The Hoard hub is not running at http://127.0.0.1:8810.');
    assert(down.code === 'hub-unreachable' && /Start the Hoard hub and Prospero/.test(down.message), 'a hub that is down says what to start');
    const stopped = await failure('app_unavailable', 'app "prospero" is not running');
    assert(stopped.code === 'app-unavailable' && /Prospero is not running or not connected/.test(stopped.message), 'an app that is stopped is named');
    const refused = await failure('tool_failed', 'name is required');
    assert(refused.code === 'tool-failed' && /Prospero refused cast_import_character: name is required/.test(refused.message), 'a refusal from the app is passed on');
    assert((await failure('timeout', 'x')).code === 'timeout' && (await failure('unauthorized', 'The hub refused this app\'s token.')).code === 'unauthorized', 'timeout and unauthorized are typed');
    setFamilyTransport(null);
    const web = await codeOf('wh_character_to_prospero', { projectId: T, characterId: anaId });
    assert(web.code === 'desktop-only' && /desktop app/.test(web.message), 'without the desktop app the tool says so instead of throwing');
    setFamilyTransport(async request => { calls.push(request); return answer(request); }, async request => { links.push(request); return { ok: true }; });
    answer = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true } });
    const noId = await call('wh_character_to_prospero', { projectId: T, characterId: anaId });
    assert(noId.sent === true && noId.prospero.id === null && /did not say which cast member/.test(noId.note), 'an answer with no id is reported honestly');
    passed.push('wh_character_to_prospero: name, description, look, PNG portrait + linked gallery, source_ref, hub link, read-only, scope, and every failure as an instruction');

    // Storyboard.
    const board = { id: `${T}-sb`, projectId: T, title: 'Escena del faro', columns: 3, createdAt: stamp, updatedAt: stamp };
    await db.storyboards.bulkAdd([board, { ...board, id: `${T}-empty`, title: 'Vacío' }]);
    const panel = (pid: string, order: number, extra: Partial<StoryboardPanel>): StoryboardPanel => ({ id: pid, storyboardId: board.id, projectId: T, order, subtitle: `Plano ${order}`, tags: [], createdAt: stamp, updatedAt: stamp, ...extra });
    await db.storyboardPanels.bulkAdd([
      panel('pn-c', 2, { subtitle: 'Cierre', duration: 'tbd' }),
      panel('pn-a', 0, { subtitle: 'Apertura', description: 'Plano general del faro', duration: '00:15-00:23', imageData: PNG_URL }),
      panel('pn-b', 1, { subtitle: 'Ana', duration: '5s', imageRef: `${T}-g1`, imageData: undefined }),
    ]);
    calls.length = 0; links.length = 0;
    answer = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true, production_id: 'p5' } });
    const sentBoard = await call('wh_storyboard_to_prospero', { projectId: T, storyboardId: board.id });
    const production = calls[0];
    assert(production.app === 'prospero' && production.tool === 'production_from_storyboard', 'the storyboard goes to production_from_storyboard');
    const pa = production.args as { title: string; source_ref: string; shots: Array<Record<string, any>> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert(pa.title === 'Escena del faro' && pa.source_ref === refStoryboard(board.id) && pa.shots.length === 3, 'title, source_ref and one shot per panel');
    assert(pa.shots.map(shot => shot.text).join('|') === 'Apertura\nPlano general del faro|Ana|Cierre', 'shots follow the panels\' order, not the order they were stored');
    assert(pa.shots[0].duration_s === 8 && pa.shots[1].duration_s === 5 && !('duration_s' in pa.shots[2]), 'durations become seconds when they are times');
    assert(pa.shots[0].image === '@file:shot-1' && pa.shots[1].image === '@file:shot-2' && !('image' in pa.shots[2]) && production.files?.length === 2 && production.files.every(file => file.base64.startsWith('iVBORw0KGgo')), 'a panel\'s own picture and the gallery picture it refers to travel as PNGs');
    assert(sentBoard.shots === 3 && sentBoard.prospero.ref === 'hoard://prospero/production/p5' && links[0].from === refStoryboard(board.id) && links[0].to === 'hoard://prospero/production/p5', 'result and link name the production');
    assert((await codeOf('wh_storyboard_to_prospero', { projectId: T, storyboardId: `${T}-empty` })).code === 'empty', 'a storyboard with no panels has nothing to send');
    assert((await codeOf('wh_storyboard_to_prospero', { projectId: T, storyboardId: 'nope' })).code === 'not-found' && (await codeOf('wh_storyboard_to_prospero', { projectId: other, storyboardId: board.id })).code === 'scope', 'unknown and foreign storyboards are refused');
    const secs: Array<[string | undefined, number | undefined]> = [['8', 8], ['8s', 8], ['1:30', 90], ['00:15-00:23', 8], ['0:10-0:05', undefined], ['a while', undefined], ['', undefined], [undefined, undefined], ['2.5 sec', 2.5], ['8,5', 8.5], ['0', undefined], ['1:02:03', 3723]];
    for (const [text, expected] of secs) assert(durationSeconds(text) === expected, `duration "${String(text)}" should be ${String(expected)}, got ${String(durationSeconds(text))}`);
    passed.push('wh_storyboard_to_prospero: shots in order, durations in seconds, panel and gallery pictures as PNGs, link, empty/unknown/foreign refused');

    // The world out.
    await db.relationships.bulkAdd([rel(`${T}-r1`, anaId, `${T}-faro`)].map(row => ({ ...row, projectId: T })));
    await db.timelines.add({ id: `${T}-tl`, projectId: T, title: 'Línea', color: '#fff', createdAt: stamp, updatedAt: stamp });
    await db.timelineEvents.add({ ...event('ev-t', `${T}-tl`, 0, 'Se apaga el faro', '', 'Año 3', anaId), projectId: T });
    calls.length = 0; links.length = 0;
    answer = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true, world: { id: 'w1', name: 'Mi mundo' }, world_created: true, counts: { created: 7 }, items: [{ section: 'characters', name: 'Ana Ruiz', state: 'created' }], world_ref: 'hoard://scheherazade/world/w1' } });
    const sentWorld = await call('wh_world_to_scheherazade', { projectId: T });
    assert(calls[0].app === 'scheherazade' && calls[0].tool === 'world_import' && !('world_id' in calls[0].args), 'the document goes to world_import; no world named means a new one');
    const sent = (calls[0].args as { data: WorldDoc }).data;
    assert(sent.schema === 'hoard.world/1' && sent.source!.ref === refProject(T) && sent.characters!.length === 2 && sent.places!.length === 1 && sent.relations!.length === 1 && sent.events!.length === 1, 'the document holds the project\'s codex, relationships and events');
    assert(sent.events![0].entities![0] === refCodex(anaId) && !JSON.stringify(sent).includes('data:image'), 'events point at entries by ref, and no picture goes out');
    assert(sentWorld.world.id === 'w1' && sentWorld.worldCreated === true && sentWorld.states.created === 7 && sentWorld.documentCounts.characters === 2 && sentWorld.linked === true && links[0].from === refProject(T) && links[0].to === 'hoard://scheherazade/world/w1' && links[0].rel === 'sent_to', 'the result carries what was sent and how each record fared there');
    await call('wh_world_to_scheherazade', { project_id: T, world_id: 'Mi mundo' });
    assert(calls[1].args.world_id === 'Mi mundo', 'a named world (snake_case works too) is the target of the merge');
    await db.relationships.add({ ...rel(`${T}-r2`, anaId, `${T}-plain`, { state: 'secret' }), projectId: T });
    await call('wh_world_to_scheherazade', { projectId: T });
    assert((calls[2].args as { data: WorldDoc }).data.relations!.length === 1, 'secret relationships stay home by default');
    await call('wh_world_to_scheherazade', { projectId: T, includeSecret: true });
    assert((calls[3].args as { data: WorldDoc }).data.relations!.length === 2, 'includeSecret sends them');
    const emptyProject = id('empty');
    await db.projects.add(project(emptyProject, 'Vacío'));
    assert((await codeOf('wh_world_to_scheherazade', { projectId: emptyProject })).code === 'empty', 'a project with no world has nothing to send');
    assert((await codeOf('wh_world_to_scheherazade', { projectId: 'nope' })).code === 'bad-args', 'an unknown project is refused');
    answer = request => ({ ok: false, code: 'tool_failed', error: 'bad_document: not a world', app: request.app, tool: request.tool });
    const refusedWorld = await codeOf('wh_world_to_scheherazade', { projectId: T });
    assert(refusedWorld.code === 'tool-failed' && /Scheherazade refused world_import/.test(refusedWorld.message), 'Scheherazade\'s refusal is passed on');

    // Records sent out and then deleted here stay deleted when the world comes back.
    answer = request => ({ ok: true, app: request.app, tool: request.tool, result: { ok: true, world: { id: 'w1', name: 'Mi mundo' }, counts: {}, world_ref: 'hoard://scheherazade/world/w1' } });
    await call('wh_world_to_scheherazade', { projectId: T });
    await db.codexEntries.delete(`${T}-plain`);
    const comeBack = await importWorldDoc(T, { schema: 'hoard.world/1', characters: [{ ref: 'hoard://scheherazade/entity/e_p', same_as: [refCodex(`${T}-plain`)], name: 'Sin retrato' }] });
    assert(comeBack.items[0].state === 'skipped' && comeBack.items[0].reason === 'deleted_locally', 'a record sent out and deleted here is not brought back by the same world');
    passed.push('wh_world_to_scheherazade: document to world_import, named world, secret relationships held back, refusals, no pictures, deleted-after-send stays deleted');

    // The world in, and undone.
    answer = request => request.tool === 'world_export'
      ? { ok: true, app: 'scheherazade', tool: 'world_export', result: { ok: true, ...clone(F) } }
      : { ok: true, app: request.app, tool: request.tool, result: { ok: true } };
    const I = id('i');
    await db.projects.add(project(I, 'Proyecto I'));
    calls.length = 0; links.length = 0;
    const brought = await call('wh_world_from_scheherazade', { projectId: I, worldId: 'Archipiélago' });
    assert(calls[0].app === 'scheherazade' && calls[0].tool === 'world_export' && calls[0].args.world_id === 'Archipiélago', 'the world is asked for by id or name');
    assert(brought.created.codexEntries === 7 && brought.created.relationships === 2 && brought.created.events === 2 && brought.created.timelines === 1 && brought.counts.created === 11 && brought.world.name === 'Archipiélago', 'everything is created');
    assert(links[0].from === refProject(I) && links[0].to === F.source!.ref && links[0].rel === 'imported_from' && brought.linked === true, 'the hub is told the project came from that world');
    const audit = brought.__audit as { entityIds: string[]; kind: string; projectId: string };
    assert(audit.kind === 'create' && audit.entityIds.length === 12 && audit.projectId === I, 'one audit line lists every row created');
    const again2 = await call('wh_world_from_scheherazade', { project_id: I, world_id: 'Archipiélago' });
    assert(again2.counts.unchanged === 11 && again2.created.codexEntries === 0 && !(again2.__audit as { entityIds?: string[] }).entityIds, 'repeating is safe and writes nothing');
    const iAna = (await db.codexEntries.where('projectId').equals(I).toArray()).find(row => row.title === 'Ana')!;
    await db.codexEntries.update(iAna.id, { content: '<p>mi versión</p>' });
    answer = request => ({ ok: true, app: 'scheherazade', tool: request.tool, result: { ok: true, ...(() => { const next = clone(F); next.characters![0].summary = 'Cambiada allá'; next.characters![0].revision = 'sha256:allá'; return next; })() } });
    const edited2 = await call('wh_world_from_scheherazade', { projectId: I, worldId: 'Archipiélago' });
    assert(edited2.counts.local_modified === 1 && /left alone/.test(edited2.hint) && (await db.codexEntries.get(iAna.id))!.content === '<p>mi versión</p>', 'an entry edited here is reported and left alone');
    answer = request => ({ ok: true, app: 'scheherazade', tool: request.tool, result: { ok: true, ...clone(F) } });
    await undoAuditEntry({ entry: auditLine('wh_world_from_scheherazade', brought) }).then(
      result => { assert(result.undone && /Removed the 12/.test(result.caveat ?? ''), 'undo says what it removed'); },
    );
    assert(!(await db.codexEntries.where('projectId').equals(I).count()) && !(await db.relationships.where('projectId').equals(I).count()) && !(await db.timelineEvents.where('projectId').equals(I).count()) && !(await db.timelines.where('projectId').equals(I).count()), 'undo removes every row the import made');
    const ledgerAfter = JSON.parse((await getSetting(`${PROJECT_SETTING_PREFIXES.familyWorld}${I}`)) ?? '{}') as { refs?: Record<string, string> };
    assert(Object.keys(ledgerAfter.refs ?? {}).length === 0, 'undo forgets the refs, so the same world can be brought in again');
    const reimport = await call('wh_world_from_scheherazade', { projectId: I, worldId: 'Archipiélago' });
    assert(reimport.counts.created === 11, 'after an undo the world is created again, not skipped as deleted');

    const codexOnly = id('co');
    await db.projects.add(project(codexOnly, 'Solo códice', ['codex']));
    const partial = await call('wh_world_from_scheherazade', { projectId: codexOnly, worldId: 'W' });
    assert(partial.created.codexEntries === 7 && partial.created.relationships === 0 && partial.created.events === 0 && partial.notes.length === 2 && partial.counts.skipped === 4, 'with the other engines off, entries come in and the rest is skipped with a note');
    const noCodex = id('nc');
    await db.projects.add(project(noCodex, 'Sin códice', ['writings']));
    const off = await codeOf('wh_world_from_scheherazade', { projectId: noCodex, worldId: 'W' });
    assert(off.code === 'engine-disabled' && /wh_enable_engine/.test(off.message) && !(await db.codexEntries.where('projectId').equals(noCodex).count()), 'a project with the codex off is refused and nothing is written');
    answer = request => ({ ok: true, app: 'scheherazade', tool: request.tool, result: { ok: true, hello: 'world' } });
    const notWorld = await codeOf('wh_world_from_scheherazade', { projectId: I, worldId: 'W' });
    assert(notWorld.code === 'bad-response' && /not a story world/.test(notWorld.message), 'an answer that is not a world is refused');
    assert((await codeOf('wh_world_from_scheherazade', { projectId: I })).code === 'bad-args', 'worldId is required');
    answer = request => ({ ok: false, code: 'app_unavailable', error: 'app "scheherazade" is not running', app: request.app, tool: request.tool });
    assert(/Start Scheherazade/.test((await codeOf('wh_world_from_scheherazade', { projectId: I, worldId: 'W' })).message), 'a stopped Scheherazade is named');
    passed.push('wh_world_from_scheherazade: creates codex/relationships/events/timeline, repeat-safe, local edits kept, one audit line, undo removes and forgets, engines off reported, refusals typed');
  } finally {
    setFamilyTransport(null);
  }

  return passed;
}
