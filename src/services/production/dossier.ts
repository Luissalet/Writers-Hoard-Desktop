import { db } from '@/db';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';
import { dialogSceneOperations } from '@/engines/dialog-scene/scopedOperations';
import { describeWorldDate, validateWorldRange } from '@/engines/timeline/worldCalendar';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { validateWeatherDate } from '@/engines/worldgen/core/weather';
import { chapterWorldContext } from '@/engines/worldgen/weatherContext';
import { projectWritingHtml } from '@/engines/writings/revisionProjection';
import { splitScenes } from '@/engines/writings/pacing/pacing';
import { buildContinuityReport, characterStateAt } from '@/services/continuity/report';
import { refCodex, refProject, WRITER_NS } from '@/services/familyBridge/worldSchema';
import { pacingText } from '@/services/pacing/report';
import { buildVoiceReport } from '@/services/voice/report';
import { getEraProject, listEraRows, readEraRow } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { CodexEntry, Writing } from '@/types';
import type { LedgerPlace } from '@/engines/writings/continuity/types';
import { BridgeError } from '@/services/aiBridge/tools/shared';
import { whGetWorldWeather } from '@/services/aiBridge/tools/worldgen';

export interface DossierInput extends WorldEraScope {
  writingId: string;
  kind: 'character' | 'scene' | 'place';
  subjectId?: string;
  placeId?: string;
  preserveDetails?: string[];
}

function card(entry: CodexEntry) {
  return {
    id: entry.id, ref: refCodex(entry.id), title: entry.title, type: entry.type,
    fields: entry.fields, text: htmlToText(entry.content), tags: entry.tags,
  };
}

async function describeScene(scope: WorldEraScope, writing: Writing, id?: string) {
  const content = projectWritingHtml(writing.content);
  if (!id || id.startsWith(`${writing.id}#`)) {
    const index = id ? Number(id.slice(writing.id.length + 1)) : null;
    const text = index === null
      ? htmlToText(content)
      : splitScenes(pacingText(content))[index]?.join('\n\n');
    if (text === undefined || (index !== null && id !== `${writing.id}#${index}`)) {
      throw new BridgeError('not-found', 'That manuscript scene is not in this chapter.');
    }
    return { id: id ?? writing.id, title: writing.title, setting: null, text, castIds: [] as string[] };
  }
  const ops = dialogSceneOperations(scope);
  const scene = await ops.getScene(id);
  if (!scene || scene.projectId !== scope.projectId) throw new BridgeError('not-found', 'The scene is not in this project.');
  const [cast, blocks] = await Promise.all([ops.getSceneCast(id), ops.getDialogBlocks(id)]);
  return {
    id, title: scene.title, setting: scene.setting ?? null,
    text: [scene.description, ...blocks.map(block =>
      [block.type === 'dialog' ? block.characterName : '', htmlToText(block.content)].filter(Boolean).join(': '))]
      .filter(Boolean).join('\n\n'),
    castIds: [...new Set([...cast, ...blocks].flatMap(member => member.characterId ? [member.characterId] : []))],
  };
}

async function approvedReferences(projectId: string, ids: Set<string>) {
  const rows = await db.visualRefs.where('projectId').equals(projectId).toArray();
  const images = new Map<string, { id: string; owners: { entityId: string; role: 'canonical' | 'sheet' | 'reference' }[] }>();
  for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    const entityId = row.codexEntryId;
    if (!entityId || !ids.has(entityId)) continue;
    const groups = [
      ['canonical', row.canonicalImageId ? [row.canonicalImageId] : []],
      ['sheet', row.sheetImageIds ?? []],
      ['reference', row.referenceImageIds],
    ] as const;
    for (const [role, group] of groups) {
      for (const id of group) {
        const image = images.get(id) ?? { id, owners: [] };
        if (!image.owners.some(owner => owner.entityId === entityId)) image.owners.push({ entityId, role });
        images.set(id, image);
      }
    }
  }
  const refs = [...images.values()];
  const stored = await db.inspirationImages.bulkGet(refs.map(ref => ref.id));
  return refs.flatMap((ref, i) => {
    const image = stored[i];
    if (image && image.projectId !== projectId) return [];
    return [{ ...ref, ref: `${WRITER_NS}image/${ref.id}`, name: image?.name ?? null, available: Boolean(image?.imageData) }];
  });
}

async function sceneWeather(scope: WorldEraScope, writing: Writing, point?: LedgerPlace) {
  if (point?.worldId && typeof point.x === 'number' && typeof point.y === 'number') {
    const calendar = await resolveWorldCalendar(scope.projectId, undefined, scope.eraId);
    if (writing.worldDate && calendar) {
      try {
        validateWeatherDate({ calendar: calendar.calendar, date: writing.worldDate });
      } catch {
        return { status: 'undated', places: [] };
      }
      try {
        return { status: 'ledger', point, sample: await whGetWorldWeather({
          ...scope, worldId: point.worldId, x: point.x, y: point.y, date: writing.worldDate,
        }) };
      } catch (error) {
        if (error instanceof BridgeError) return { status: 'unavailable', point, places: [] };
        throw error;
      }
    }
  }
  return chapterWorldContext(scope, writing.id);
}

export async function compileProductionDossier(input: DossierInput) {
  const { projectId, eraId, writingId, kind, subjectId, placeId } = input;
  const scope = { projectId, eraId };
  const writing = await readEraRow<Writing>(scope, 'writings', writingId);
  if (!writing || writing.projectId !== projectId) throw new BridgeError('not-found', 'The chapter is not in this project.');
  const [project, codex, resolved, scene, continuity, voice] = await Promise.all([
    getEraProject(scope),
    listEraRows<CodexEntry>(scope, 'codexEntries'),
    resolveWorldCalendar(projectId, undefined, eraId),
    describeScene(scope, writing, kind === 'scene' ? subjectId : undefined),
    buildContinuityReport(projectId, { eraId, skipTravel: true }),
    buildVoiceReport(projectId, eraId),
  ]);
  const entries = new Map(codex.map(entry => [entry.id, entry]));
  const subject = subjectId && kind !== 'scene' ? entries.get(subjectId) : undefined;
  if (kind !== 'scene' && subject?.type !== (kind === 'place' ? 'location' : 'character')) {
    throw new BridgeError('bad-args', `Choose a ${kind} card in this project.`);
  }
  const requestedPlace = placeId ? entries.get(placeId) : kind === 'place' ? subject : undefined;
  if (placeId && requestedPlace?.type !== 'location') throw new BridgeError('bad-args', 'Choose a place card in this project.');

  const castIds = new Set(scene.castIds);
  const chapterCast = voice.lines.filter(line => line.speakerId
    && (line.sceneId === scene.id || (scene.id.startsWith(writing.id) && line.writingId === writingId)));
  for (const line of chapterCast) if (line.speakerId) castIds.add(line.speakerId);
  const text = scene.text.toLocaleLowerCase();
  const characters = codex.filter(entry => entry.type === 'character' && (
    kind === 'character' ? entry.id === subjectId
      : castIds.has(entry.id) || text.includes(entry.title.toLocaleLowerCase())
        || (requestedPlace && writing.chapter !== undefined
          && characterStateAt(continuity, entry.id, writing.chapter).location?.entryId === requestedPlace.id)
  )).sort((a, b) => a.id.localeCompare(b.id)).map(entry => ({
    ...card(entry),
    voice: {
      description: voice.descriptions[entry.id] ?? null,
      profile: voice.profiles.find(profile => profile.characterId === entry.id) ?? null,
      examples: voice.lines.filter(line => line.speakerId === entry.id)
        .sort((a, b) => Number(b.sceneId === scene.id || b.writingId === writingId) - Number(a.sceneId === scene.id || a.writingId === writingId))
        .slice(0, 6).map(line => ({ quote: line.text, chapterId: line.writingId ?? null, sceneId: line.sceneId ?? null })),
    },
    state: writing.chapter !== undefined && continuity.placed.some(line => line.characterId === entry.id && line.chapter <= writing.chapter!)
      ? characterStateAt(continuity, entry.id, writing.chapter) : null,
  }));
  const locations = characters.flatMap(character => character.state?.location ? [character.state.location] : []);
  const placeIds = new Set(requestedPlace ? [requestedPlace.id] : locations.flatMap(place => place.entryId ? [place.entryId] : []));
  const places = codex.filter(entry => entry.type === 'location' && placeIds.has(entry.id)).map(card).sort((a, b) => a.id.localeCompare(b.id));
  const carriedIds = new Set(characters.flatMap(character => (character.state?.carries ?? []).flatMap(item => item.itemId ? [item.itemId] : [])));
  const objects = codex.filter(entry => carriedIds.has(entry.id)).map(card).sort((a, b) => a.id.localeCompare(b.id));
  const pointMap = new Map(locations.filter(place => place.worldId && place.x !== undefined && place.y !== undefined
    && (!requestedPlace || place.entryId === requestedPlace.id)).map(place => [`${place.worldId}:${place.x}:${place.y}`, place]));
  const calendar = resolved?.calendar;
  const date = writing.worldDate && calendar && !validateWorldRange(calendar, writing.worldDate)
    ? describeWorldDate(calendar, writing.worldDate) : null;
  const sourceId = subject?.id ?? scene.id;
  const [weather, references] = await Promise.all([
    sceneWeather(scope, writing, pointMap.size === 1 ? pointMap.values().next().value : undefined),
    approvedReferences(projectId, new Set([...characters, ...places, ...objects].map(entry => entry.id))),
  ]);
  const preserveDetails = [...new Set([...(writing.preserveDetails ?? []), ...(input.preserveDetails ?? [])]
    .map(detail => detail.trim()).filter(Boolean))];
  return {
    schema: 'hoard.production-dossier/1' as const,
    title: subject?.title ?? scene.title,
    subject: { kind, id: sourceId, ref: subject ? refCodex(subject.id) : `${WRITER_NS}${sourceId === writingId ? 'writing' : 'scene'}/${sourceId}` },
    project: { id: projectId, ref: refProject(projectId), title: project.title, eraId: eraId ?? null },
    chapter: { id: writingId, ref: `${WRITER_NS}writing/${writingId}`, title: writing.title, number: writing.chapter ?? null,
      synopsis: writing.synopsis ?? null, date: writing.worldDate ?? null, dateEnd: writing.worldDateEnd ?? null, dateLabel: date?.label ?? null,
      sceneTime: writing.sceneTime ?? null },
    scene: { id: scene.id, title: scene.title, setting: scene.setting, text: scene.text },
    characters, places, objects,
    world: { visualStyle: project.worldVisualStyle ?? null, moons: date?.date.approx ? [] : date?.moons ?? [], weather },
    references, preserveDetails,
  };
}

export type ProductionDossier = Awaited<ReturnType<typeof compileProductionDossier>>;

