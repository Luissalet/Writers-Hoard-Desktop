import { stripHtml } from '@/utils/text';
import type { DialogBlock, Scene } from '@/engines/dialog-scene/types';
import type { OutlineBeat } from '@/engines/outline/types';
import type { EntityLink } from '@/types/projectTools';
import type { Writing } from '@/types';
import type {
  CharacterVoiceProfile,
  CreationRhythmDay,
  NarrativeEnergyUnit,
  NarrativeEvidence,
  NarrativeRhythmUnit,
  NarrativeThread,
  NarrativeXrayInput,
  NarrativeXrayLocale,
  NarrativeXrayModel,
  ProseVoiceProfile,
  TextMeasure,
} from './types';

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const SENTENCE_END_RE = /[.!?…]+(?:[”"'’»)]*)|\n+/g;
const SHORT_SENTENCE_WORDS = 8;
const MAX_EVIDENCE_PER_SIGNAL = 4;

const STOP_WORDS = new Set([
  // English and Spanish are both included so a mixed-language project stays
  // deterministic when the application language changes.
  'a', 'al', 'algo', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'como', 'con', 'cuando', 'de', 'del', 'desde', 'do', 'el', 'ella', 'en', 'era',
  'es', 'esa', 'ese', 'esta', 'este', 'for', 'from', 'fue', 'ha', 'had', 'has',
  'have', 'he', 'her', 'him', 'his', 'i', 'in', 'is', 'it', 'la', 'las', 'le',
  'lo', 'los', 'más', 'me', 'mi', 'my', 'no', 'not', 'of', 'on', 'or', 'para',
  'pero', 'por', 'que', 'se', 'she', 'sin', 'so', 'su', 'sus', 'than', 'that',
  'the', 'their', 'them', 'they', 'this', 'to', 'un', 'una', 'uno', 'was', 'we',
  'were', 'what', 'when', 'with', 'y', 'ya', 'yo', 'you', 'your',
]);

const REFERENCE_MARKERS = {
  firstPerson: new Set(['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours', 'yo', 'me', 'mi', 'mío', 'mía', 'nos', 'nuestro', 'nuestra']),
  secondPerson: new Set(['you', 'your', 'yours', 'tú', 'tu', 'tuyo', 'tuya', 'usted', 'ustedes', 'vosotros', 'vosotras']),
  thirdPerson: new Set(['he', 'him', 'his', 'she', 'her', 'hers', 'they', 'them', 'their', 'él', 'ella', 'ellos', 'ellas', 'lo', 'la', 'le', 'les', 'su', 'sus']),
} as const;

interface TextSlice {
  text: string;
  start: number;
  end: number;
  words: string[];
}

interface EntityDescriptor {
  engineId: string;
  entityType: string;
  entityId: string;
  title: string;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function wordsOf(text: string): string[] {
  return [...text.matchAll(WORD_RE)].map((match) => match[0].toLocaleLowerCase('und'));
}

function splitSentences(text: string): TextSlice[] {
  if (!text.trim()) return [];
  const slices: TextSlice[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END_RE)) {
    const end = (match.index ?? 0) + match[0].length;
    const raw = text.slice(start, end);
    const leading = raw.search(/\S/);
    const body = raw.trim();
    if (body) {
      const sliceStart = start + Math.max(0, leading);
      slices.push({ text: body, start: sliceStart, end: sliceStart + body.length, words: wordsOf(body) });
    }
    start = end;
  }
  const tail = text.slice(start);
  const leading = tail.search(/\S/);
  const body = tail.trim();
  if (body) {
    const sliceStart = start + Math.max(0, leading);
    slices.push({ text: body, start: sliceStart, end: sliceStart + body.length, words: wordsOf(body) });
  }
  return slices;
}

function plainParagraphs(htmlOrText: string): string[] {
  if (!htmlOrText.trim()) return [];
  const withBreaks = htmlOrText
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre)>/gi, '\n');
  return withBreaks
    .split(/\n+/)
    .map((part) => stripHtml(part).trim())
    .filter(Boolean);
}

export function measureNarrativeText(htmlOrText: string): TextMeasure {
  const plain = stripHtml(htmlOrText);
  const words = wordsOf(plain);
  const sentences = splitSentences(plain);
  const paragraphs = plainParagraphs(htmlOrText);
  const sentenceLengths = sentences.map((sentence) => sentence.words.length).filter(Boolean).sort((a, b) => a - b);
  const paragraphWords = paragraphs.map((paragraph) => wordsOf(paragraph).length);
  const middle = Math.floor(sentenceLengths.length / 2);
  const medianSentenceWords = sentenceLengths.length === 0
    ? 0
    : sentenceLengths.length % 2 === 1
      ? sentenceLengths[middle]
      : (sentenceLengths[middle - 1] + sentenceLengths[middle]) / 2;
  return {
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    averageSentenceWords: sentences.length ? round(words.length / sentences.length) : 0,
    medianSentenceWords: round(medianSentenceWords),
    averageParagraphWords: paragraphs.length
      ? round(paragraphWords.reduce((sum, count) => sum + count, 0) / paragraphs.length)
      : 0,
    questions: (plain.match(/\?/g) ?? []).length,
    exclamations: (plain.match(/!/g) ?? []).length,
    shortSentences: sentences.filter((sentence) => sentence.words.length > 0 && sentence.words.length <= SHORT_SENTENCE_WORDS).length,
  };
}

function orderWritings(rows: readonly Writing[]): Writing[] {
  return [...rows].sort((a, b) => {
    const aChapter = typeof a.chapter === 'number' ? a.chapter : Number.MAX_SAFE_INTEGER;
    const bChapter = typeof b.chapter === 'number' ? b.chapter : Number.MAX_SAFE_INTEGER;
    return aChapter - bChapter || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  });
}

function orderScenes(rows: readonly Scene[]): Scene[] {
  return [...rows].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function orderBeats(rows: readonly OutlineBeat[]): OutlineBeat[] {
  return [...rows].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function excerpt(text: string, start: number, end: number): string {
  const padding = 54;
  const from = Math.max(0, start - padding);
  const to = Math.min(text.length, end + padding);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
}

function textEvidence(
  descriptor: EntityDescriptor,
  plain: string,
  range?: { start: number; end: number },
  detail?: string,
): NarrativeEvidence {
  return {
    id: `${descriptor.engineId}:${descriptor.entityType}:${descriptor.entityId}${range ? `:${range.start}-${range.end}` : ''}${detail ? `:${detail}` : ''}`,
    ...descriptor,
    excerpt: range ? excerpt(plain, range.start, range.end) : plain.slice(0, 140) || undefined,
    range,
    detail,
  };
}

function recurringTerms(
  htmlOrText: string,
  descriptor: EntityDescriptor,
): Array<{ term: string; count: number; evidence: NarrativeEvidence[] }> {
  const plain = stripHtml(htmlOrText);
  const matches = [...plain.matchAll(WORD_RE)];
  const occurrences = new Map<string, Array<{ start: number; end: number }>>();
  for (const match of matches) {
    const term = match[0].toLocaleLowerCase('und');
    if (term.length < 3 || STOP_WORDS.has(term) || /^\d+$/.test(term)) continue;
    const start = match.index ?? 0;
    occurrences.set(term, [...(occurrences.get(term) ?? []), { start, end: start + match[0].length }]);
  }
  return [...occurrences.entries()]
    .filter(([, ranges]) => ranges.length > 1)
    .sort(([termA, rangesA], [termB, rangesB]) => rangesB.length - rangesA.length || termA.localeCompare(termB))
    .slice(0, 5)
    .map(([term, ranges]) => ({
      term,
      count: ranges.length,
      evidence: ranges.slice(0, MAX_EVIDENCE_PER_SIGNAL).map((range) => textEvidence(descriptor, plain, range, term)),
    }));
}

function recurringTermsAcross(
  sources: ReadonlyArray<{ text: string; descriptor: EntityDescriptor }>,
): Array<{ term: string; count: number; evidence: NarrativeEvidence[] }> {
  const occurrences = new Map<string, Array<{ plain: string; descriptor: EntityDescriptor; start: number; end: number }>>();
  for (const source of sources) {
    const plain = stripHtml(source.text);
    for (const match of plain.matchAll(WORD_RE)) {
      const term = match[0].toLocaleLowerCase('und');
      if (term.length < 3 || STOP_WORDS.has(term) || /^\d+$/.test(term)) continue;
      const start = match.index ?? 0;
      occurrences.set(term, [...(occurrences.get(term) ?? []), {
        plain,
        descriptor: source.descriptor,
        start,
        end: start + match[0].length,
      }]);
    }
  }
  return [...occurrences.entries()]
    .filter(([, ranges]) => ranges.length > 1)
    .sort(([termA, rangesA], [termB, rangesB]) => rangesB.length - rangesA.length || termA.localeCompare(termB))
    .slice(0, 5)
    .map(([term, ranges]) => ({
      term,
      count: ranges.length,
      evidence: ranges.slice(0, MAX_EVIDENCE_PER_SIGNAL).map((item) => textEvidence(
        item.descriptor,
        item.plain,
        { start: item.start, end: item.end },
        term,
      )),
    }));
}

function markerRate(words: readonly string[], markers: ReadonlySet<string>): number {
  if (words.length === 0) return 0;
  return round((words.filter((word) => markers.has(word)).length / words.length) * 1000);
}

function writingEvidence(writing: Writing): NarrativeEvidence {
  return textEvidence(
    { engineId: 'writings', entityType: 'writing', entityId: writing.id, title: writing.title },
    stripHtml(writing.content),
  );
}

function buildProseVoice(writings: readonly Writing[]): ProseVoiceProfile[] {
  return writings.map((writing, order) => {
    const plain = stripHtml(writing.content);
    const words = wordsOf(plain);
    const descriptor: EntityDescriptor = {
      engineId: 'writings', entityType: 'writing', entityId: writing.id, title: writing.title,
    };
    return {
      writingId: writing.id,
      title: writing.title,
      order,
      measure: measureNarrativeText(writing.content),
      referenceMarkers: {
        firstPerson: markerRate(words, REFERENCE_MARKERS.firstPerson),
        secondPerson: markerRate(words, REFERENCE_MARKERS.secondPerson),
        thirdPerson: markerRate(words, REFERENCE_MARKERS.thirdPerson),
      },
      recurringTerms: recurringTerms(writing.content, descriptor),
      evidence: [writingEvidence(writing)],
    };
  });
}

function buildCharacterVoice(blocks: readonly DialogBlock[], sceneById: ReadonlyMap<string, Scene>): CharacterVoiceProfile[] {
  const groups = new Map<string, DialogBlock[]>();
  for (const block of blocks) {
    if (block.type !== 'dialog') continue;
    const name = block.characterName.trim() || '—';
    const key = block.characterId ? `id:${block.characterId}` : `name:${name.toLocaleLowerCase('und')}`;
    groups.set(key, [...(groups.get(key) ?? []), block]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const ordered = [...rows].sort((a, b) => {
      const sceneOrderA = sceneById.get(a.sceneId)?.order ?? Number.MAX_SAFE_INTEGER;
      const sceneOrderB = sceneById.get(b.sceneId)?.order ?? Number.MAX_SAFE_INTEGER;
      return sceneOrderA - sceneOrderB || a.order - b.order || a.id.localeCompare(b.id);
    });
    const joined = ordered.map((row) => row.content).join('\n');
    const lineLengths = ordered.map((row) => wordsOf(stripHtml(row.content)).length).sort((a, b) => a - b);
    const middle = Math.floor(lineLengths.length / 2);
    const median = lineLengths.length % 2 === 1
      ? lineLengths[middle]
      : ((lineLengths[middle - 1] ?? 0) + (lineLengths[middle] ?? 0)) / 2;
    const first = ordered[0];
    const characterName = first.characterName.trim() || '—';
    const evidence = ordered.slice(0, MAX_EVIDENCE_PER_SIGNAL).map((row) => textEvidence(
      {
        engineId: 'dialog-scene', entityType: 'dialog-block', entityId: row.id,
        title: `${characterName} · ${sceneById.get(row.sceneId)?.title ?? row.sceneId}`,
      },
      stripHtml(row.content),
    ));
    return {
      characterKey: key,
      characterId: first.characterId,
      characterName,
      lineCount: ordered.length,
      words: wordsOf(stripHtml(joined)).length,
      medianLineWords: round(median),
      questions: (joined.match(/\?/g) ?? []).length,
      exclamations: (joined.match(/!/g) ?? []).length,
      recurringTerms: recurringTermsAcross(ordered.map((row) => ({
        text: row.content,
        descriptor: {
          engineId: 'dialog-scene', entityType: 'dialog-block', entityId: row.id,
          title: `${characterName} · ${sceneById.get(row.sceneId)?.title ?? row.sceneId}`,
        },
      }))),
      evidence,
    };
  }).sort((a, b) => b.lineCount - a.lineCount || a.characterName.localeCompare(b.characterName));
}

function annotationCountsByEntity(annotations: NarrativeXrayInput['annotations']): Map<string, number> {
  const counts = new Map<string, number>();
  for (const annotation of annotations) {
    const key = `${annotation.sourceEngineId}:${annotation.sourceEntityId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function buildNarrativeRhythm(
  writings: readonly Writing[],
  scenes: readonly Scene[],
  beats: readonly OutlineBeat[],
  blocks: readonly DialogBlock[],
  annotationCounts: ReadonlyMap<string, number>,
): NarrativeRhythmUnit[] {
  const blocksByScene = new Map<string, DialogBlock[]>();
  for (const block of blocks) blocksByScene.set(block.sceneId, [...(blocksByScene.get(block.sceneId) ?? []), block]);

  const writingUnits: NarrativeRhythmUnit[] = writings.map((writing, order) => ({
    id: `writing:${writing.id}`,
    source: 'writing',
    title: writing.title,
    order,
    measure: measureNarrativeText(writing.content),
    annotationCount: annotationCounts.get(`writings:${writing.id}`) ?? 0,
    evidence: writingEvidence(writing),
  }));
  const sceneUnits: NarrativeRhythmUnit[] = scenes.map((scene, order) => {
    const sceneBlocks = (blocksByScene.get(scene.id) ?? []).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const content = sceneBlocks.map((block) => block.content).join('\n');
    return {
      id: `scene:${scene.id}`,
      source: 'scene',
      title: scene.title,
      order,
      measure: measureNarrativeText(content),
      explicitDialogBlocks: sceneBlocks.filter((block) => block.type === 'dialog').length,
      explicitActionBlocks: sceneBlocks.filter((block) => block.type === 'action' || block.type === 'stage-direction').length,
      annotationCount: annotationCounts.get(`dialog-scene:${scene.id}`) ?? 0,
      evidence: textEvidence(
        { engineId: 'dialog-scene', entityType: 'scene', entityId: scene.id, title: scene.title },
        stripHtml(content || scene.description || ''),
      ),
    };
  });
  const beatUnits: NarrativeRhythmUnit[] = beats.map((beat, order) => ({
    id: `outline-beat:${beat.id}`,
    source: 'outline-beat',
    title: beat.title,
    order,
    measure: measureNarrativeText(beat.description),
    plannedWords: beat.wordTarget,
    annotationCount: annotationCounts.get(`outline:${beat.id}`) ?? 0,
    evidence: textEvidence(
      { engineId: 'outline', entityType: 'outline-beat', entityId: beat.id, title: beat.title },
      stripHtml(beat.description),
      undefined,
      beat.status,
    ),
  }));
  return [...writingUnits, ...sceneUnits, ...beatUnits];
}

function buildCreationRhythm(sessions: NarrativeXrayInput['writingSessions']): CreationRhythmDay[] {
  const byDate = new Map<string, NarrativeXrayInput['writingSessions'][number][]>();
  for (const session of sessions) byDate.set(session.date, [...(byDate.get(session.date) ?? []), session]);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      date,
      words: rows.reduce((sum, row) => sum + row.wordCount, 0),
      durationSeconds: rows.reduce((sum, row) => sum + row.duration, 0),
      sessionCount: rows.length,
      sessionTypes: [...new Set(rows.map((row) => row.type))].sort(),
      evidence: [...rows]
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map((row): NarrativeEvidence => ({
          id: `writing-stats:writing-session:${row.id}`,
          engineId: 'writing-stats', entityType: 'writing-session', entityId: row.id,
          title: row.date,
          excerpt: row.notes?.trim() || undefined,
          detail: row.type,
        })),
    }));
}

function per100(value: number, words: number): number {
  return words > 0 ? round((value / words) * 100) : 0;
}

function buildEnergy(units: readonly NarrativeRhythmUnit[]): NarrativeEnergyUnit[] {
  return units.map((unit) => {
    const explicitBlocks = (unit.explicitDialogBlocks ?? 0) + (unit.explicitActionBlocks ?? 0);
    return {
      id: unit.id,
      source: unit.source,
      title: unit.title,
      order: unit.order,
      words: unit.measure.words,
      shortSentencesPer100Words: per100(unit.measure.shortSentences, unit.measure.words),
      questionsPer100Words: per100(unit.measure.questions, unit.measure.words),
      exclamationsPer100Words: per100(unit.measure.exclamations, unit.measure.words),
      explicitDialogShare: explicitBlocks ? round((unit.explicitDialogBlocks ?? 0) / explicitBlocks * 100) : undefined,
      explicitActionShare: explicitBlocks ? round((unit.explicitActionBlocks ?? 0) / explicitBlocks * 100) : undefined,
      evidence: [unit.evidence],
    };
  });
}

function entityKey(engineId: string, entityId: string): string {
  return `${engineId}:${entityId}`;
}

function canonicalThreadLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function knownEntities(
  writings: readonly Writing[],
  scenes: readonly Scene[],
  beats: readonly OutlineBeat[],
): Map<string, EntityDescriptor> {
  const result = new Map<string, EntityDescriptor>();
  for (const writing of writings) {
    result.set(entityKey('writings', writing.id), {
      engineId: 'writings', entityType: 'writing', entityId: writing.id, title: writing.title,
    });
  }
  for (const scene of scenes) {
    result.set(entityKey('dialog-scene', scene.id), {
      engineId: 'dialog-scene', entityType: 'scene', entityId: scene.id, title: scene.title,
    });
  }
  for (const beat of beats) {
    result.set(entityKey('outline', beat.id), {
      engineId: 'outline', entityType: 'outline-beat', entityId: beat.id, title: beat.title,
    });
  }
  return result;
}

function buildThreads(
  writings: readonly Writing[],
  scenes: readonly Scene[],
  beats: readonly OutlineBeat[],
  tags: NarrativeXrayInput['tags'],
  links: readonly EntityLink[],
): NarrativeThread[] {
  const tagMeta = new Map<string, { name: string; color?: string }>();
  for (const tag of tags) {
    const meta = { name: tag.name, color: tag.color };
    tagMeta.set(tag.id.toLocaleLowerCase('und'), meta);
    tagMeta.set(tag.name.toLocaleLowerCase('und'), meta);
  }
  const tagUses = new Map<string, Array<{ label: string; color?: string; descriptor: EntityDescriptor }>>();
  const addTags = (rowTags: readonly string[], descriptor: EntityDescriptor) => {
    for (const raw of rowTags) {
      const label = canonicalThreadLabel(raw);
      if (!label) continue;
      const meta = tagMeta.get(label.toLocaleLowerCase('und'));
      const normalized = (meta?.name ?? label).toLocaleLowerCase('und');
      tagUses.set(normalized, [...(tagUses.get(normalized) ?? []), {
        label: meta?.name ?? label,
        color: meta?.color,
        descriptor,
      }]);
    }
  };
  for (const writing of writings) addTags(writing.tags, {
    engineId: 'writings', entityType: 'writing', entityId: writing.id, title: writing.title,
  });
  for (const scene of scenes) addTags(scene.tags, {
    engineId: 'dialog-scene', entityType: 'scene', entityId: scene.id, title: scene.title,
  });

  const tagThreads: NarrativeThread[] = [...tagUses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([normalized, uses]) => {
      const unique = new Map(uses.map((use) => [entityKey(use.descriptor.engineId, use.descriptor.entityId), use]));
      const evidence = [...unique.values()].map((use): NarrativeEvidence => ({
        id: `tag:${normalized}:${entityKey(use.descriptor.engineId, use.descriptor.entityId)}`,
        ...use.descriptor,
        detail: use.label,
      }));
      return {
        id: `tag:${normalized}`,
        origin: 'tag',
        label: uses[0].label,
        color: uses.find((use) => use.color)?.color,
        evidence,
        entityKeys: [...unique.keys()].sort(),
      };
    });

  const entities = knownEntities(writings, scenes, beats);
  const relationGroups = new Map<string, EntityLink[]>();
  for (const link of links) {
    const relation = canonicalThreadLabel(link.relation);
    if (!relation) continue;
    const normalized = relation.toLocaleLowerCase('und');
    relationGroups.set(normalized, [...(relationGroups.get(normalized) ?? []), link]);
  }
  const linkThreads: NarrativeThread[] = [...relationGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([normalized, rows]) => {
      const evidenceByEntity = new Map<string, NarrativeEvidence>();
      for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
        for (const endpoint of [
          { engineId: row.sourceEngineId, entityType: row.sourceEntityType, entityId: row.sourceEntityId, title: row.sourceTitle },
          { engineId: row.targetEngineId, entityType: row.targetEntityType, entityId: row.targetEntityId, title: row.targetTitle },
        ]) {
          const key = entityKey(endpoint.engineId, endpoint.entityId);
          const current = entities.get(key) ?? endpoint;
          if (!evidenceByEntity.has(key)) evidenceByEntity.set(key, {
            id: `entity-link:${row.id}:${key}`,
            ...current,
            excerpt: row.notes,
            detail: row.relation,
          });
        }
      }
      return {
        id: `entity-link:${normalized}`,
        origin: 'entity-link',
        label: rows[0].relation,
        relation: rows[0].relation,
        evidence: [...evidenceByEntity.values()],
        entityKeys: [...evidenceByEntity.keys()].sort(),
      };
    });
  return [...tagThreads, ...linkThreads];
}

function projectLocale(locale: NarrativeXrayInput['locale']): NarrativeXrayLocale {
  return locale === 'en' ? 'en' : 'es';
}

/** Build the entire read model without I/O, random values, clocks, or writes. */
export function buildNarrativeXray(input: NarrativeXrayInput): NarrativeXrayModel {
  const projectId = input.projectId;
  const writings = orderWritings(input.writings.filter((row) => row.projectId === projectId));
  const scenes = orderScenes(input.scenes.filter((row) => row.projectId === projectId));
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const dialogBlocks = input.dialogBlocks
    .filter((row) => row.projectId === projectId && sceneIds.has(row.sceneId))
    .slice()
    .sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.order - b.order || a.id.localeCompare(b.id));
  const outlineBeats = orderBeats(input.outlineBeats.filter((row) => row.projectId === projectId));
  const writingSessions = input.writingSessions.filter((row) => row.projectId === projectId);
  const annotations = input.annotations.filter((row) => row.projectId === projectId);
  const entityLinks = input.entityLinks.filter((row) => row.projectId === projectId);
  const annotationCounts = annotationCountsByEntity(annotations);
  const narrativeRhythm = buildNarrativeRhythm(writings, scenes, outlineBeats, dialogBlocks, annotationCounts);

  return {
    projectId,
    locale: projectLocale(input.locale),
    coverage: {
      writings: writings.length,
      outlineBeats: outlineBeats.length,
      scenes: scenes.length,
      dialogBlocks: dialogBlocks.length,
      annotations: annotations.length,
      writingSessions: writingSessions.length,
      entityLinks: entityLinks.length,
    },
    voice: {
      prose: buildProseVoice(writings),
      characters: buildCharacterVoice(dialogBlocks, new Map(scenes.map((scene) => [scene.id, scene]))),
    },
    rhythm: {
      narrative: narrativeRhythm,
      creation: buildCreationRhythm(writingSessions),
    },
    energy: buildEnergy(narrativeRhythm),
    threads: buildThreads(writings, scenes, outlineBeats, input.tags, entityLinks),
  };
}
