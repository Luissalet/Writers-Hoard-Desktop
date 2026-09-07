import { db } from '@/db';
import { buildProjectEditorialContext } from '@/services/editorialProfile';
import { compareManuscriptOrder } from '@/engines/writings/chapterOrder';
import { parseJsonFromModel } from '@/services/aiText';
import { chatStream } from '@/services/aiRuntime/client';
import type { AiConnectionSummary, AiRouteSelection } from '@/services/aiRuntime/types';
import { getProjectSettings } from '@/services/copilot/threads';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import type { Writing } from '@/types';
import { stripHtml } from '@/utils/text';
import { generateId } from '@/utils/idGenerator';
import { foldJudgeText, lexicalTerms, sha256Hex } from './text';
import type {
  JudgeConfidence,
  JudgeContextPermissions,
  JudgeFinding,
  JudgeInternalCitation,
  JudgeMode,
  JudgePayloadReceipt,
  JudgeReferenceCitation,
  JudgeRun,
  JudgeRunFreshness,
  JudgeScope,
  JudgeSourceMode,
  JudgeSuggestion,
  ProjectReferenceLink,
  ReferenceDocument,
  ReferenceLens,
  ReferenceSection,
} from './types';

const TARGET_CHUNK = 5_000;
const TARGET_BUDGET = 30_000;
const SOURCE_CHUNK = 1_600;
const REFERENCE_LIMIT_PER_LENS = 7;
const INTERNAL_LIMIT = 12;

interface EvidenceBase {
  id: string;
  text: string;
  hash: string;
}

interface TargetEvidence extends EvidenceBase {
  writingId: string;
  title: string;
  start: number;
  end: number;
}

interface ReferenceEvidence extends EvidenceBase {
  document: ReferenceDocument;
  lens: ReferenceLens;
  section: ReferenceSection;
}

interface InternalEvidence extends EvidenceBase {
  engineId: string;
  entityId: string;
  title: string;
  start: number;
  end: number;
}

export interface JudgeRouteInfo {
  route: AiRouteSelection;
  connectionName: string;
  locality: JudgePayloadReceipt['routeLocality'];
  remoteConsentPolicy: boolean;
}

export interface JudgeSelection {
  text: string;
  /** Plain-text offsets when known. The runner safely locates the quote otherwise. */
  start?: number;
  end?: number;
}

export interface RunJudgeInput {
  projectId: string;
  writing: Writing;
  currentContent: string;
  mode: JudgeMode;
  scope: JudgeScope;
  sourceMode: JudgeSourceMode;
  lensIds: string[];
  context: JudgeContextPermissions;
  selection?: JudgeSelection;
  allowRemote?: boolean;
  /** Exact payload plan the user approved in the one-time disclosure dialog. */
  expectedDisclosureFingerprint?: string;
  outputLanguage?: string;
  signal?: AbortSignal;
  onStage?: (stage: 'collecting' | 'analysing' | 'saving', completed: number, total: number) => void;
}

export interface RunJudgeResult {
  run: JudgeRun;
  findings: JudgeFinding[];
  invalidFindings: number;
}

interface ModelFinding {
  targetEvidenceId?: unknown;
  quote?: unknown;
  observation?: unknown;
  kind?: unknown;
  principle?: unknown;
  sourceEvidenceId?: unknown;
  sourceQuote?: unknown;
  internalEvidenceId?: unknown;
  internalQuote?: unknown;
  confidence?: unknown;
  contextLimits?: unknown;
  suggestion?: unknown;
}

interface ModelEnvelope {
  findings?: unknown;
}

function localityOf(connection: AiConnectionSummary): JudgePayloadReceipt['routeLocality'] {
  if (connection.locality === 'embedded' || connection.locality === 'loopback') return 'local';
  if (connection.locality === 'lan') return 'lan';
  if (connection.locality === 'remote') return 'remote';
  return 'unknown';
}

export async function getJudgeRouteInfo(projectId: string): Promise<JudgeRouteInfo> {
  const store = useAiRuntimeStore.getState();
  await Promise.all([
    store.connectionsLoaded ? Promise.resolve() : store.loadConnections(),
    Object.keys(store.defaults).length ? Promise.resolve() : store.loadDefaults(),
  ]);
  const settings = await getProjectSettings(projectId);
  const state = useAiRuntimeStore.getState();
  const route = settings.chatRoute ?? state.defaults.chat;
  if (!route) throw new Error('judge-route-missing');
  const connection = state.connections.find(candidate => candidate.id === route.connectionId);
  if (!connection || !connection.enabled) throw new Error('judge-route-missing');
  return {
    route,
    connectionName: connection.name,
    locality: localityOf(connection),
    remoteConsentPolicy: settings.remoteConsent,
  };
}

function splitAtBoundaries(text: string, max: number): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + max);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('. ', end));
      if (boundary > cursor + Math.floor(max * 0.55)) end = boundary + (text.startsWith('\n\n', boundary) ? 2 : 1);
    }
    const leading = text.slice(cursor, end).search(/\S/);
    if (leading === -1) {
      cursor = end;
      continue;
    }
    const start = cursor + leading;
    const raw = text.slice(start, end);
    const trimmed = raw.trimEnd();
    out.push({ text: trimmed, start, end: start + trimmed.length });
    cursor = Math.max(end, cursor + 1);
  }
  return out;
}

function overlapScore(text: string, wanted: Set<string>): number {
  if (!wanted.size) return 0;
  const terms = lexicalTerms(text);
  let score = 0;
  for (const term of terms) if (wanted.has(term)) score += 1;
  return score / Math.sqrt(Math.max(1, terms.length));
}

function selectEvidence<T extends EvidenceBase>(rows: T[], targetText: string, limit: number): T[] {
  const wanted = new Set(lexicalTerms(targetText));
  return rows
    .map((row, index) => ({ row, index, score: overlapScore(row.text, wanted) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(item => item.row);
}

async function targetEvidence(input: RunJudgeInput): Promise<{
  evidence: TargetEvidence[];
  targetHash: string;
  targetVersions: JudgeRun['targetVersions'];
  truncated: boolean;
}> {
  if (input.writing.projectId !== input.projectId) throw new Error('judge-writing-out-of-scope');
  const currentPlain = stripHtml(input.currentContent);
  let writings: Array<{ row: Writing; plain: string }> = [{ row: input.writing, plain: currentPlain }];
  if (input.scope === 'writings') {
    const ids = [...new Set([input.writing.id, ...input.context.selectedWritingIds])];
    const fetched = await db.writings.bulkGet(ids);
    writings = fetched.flatMap(row => row?.projectId === input.projectId ? [{
      row,
      plain: row.id === input.writing.id ? currentPlain : stripHtml(row.content),
    }] : []);
  }

  const versions = await Promise.all(writings.map(async ({ row, plain }) => ({
    writingId: row.id,
    contentHash: await sha256Hex(plain),
  })));
  const selectedText = input.selection?.text.replace(/\s+/g, ' ').trim();
  const selectionLocation = selectedText
    ? exactLocation(currentPlain, selectedText, input.selection?.start)
    : null;
  const analysisTexts = input.scope === 'selection' && selectedText
    ? [{ row: input.writing, plain: selectedText, base: selectionLocation?.start ?? 0 }]
    : writings.map(value => ({ ...value, base: 0 }));

  const all: TargetEvidence[] = [];
  let used = 0;
  let truncated = false;
  for (const { row, plain, base } of analysisTexts) {
    for (const chunk of splitAtBoundaries(plain, TARGET_CHUNK)) {
      const remaining = TARGET_BUDGET - used;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const text = chunk.text.slice(0, remaining);
      if (text.length < chunk.text.length) truncated = true;
      all.push({
        id: `target:${row.id}:${all.length + 1}`,
        writingId: row.id,
        title: row.title,
        text,
        start: Math.max(0, base) + chunk.start,
        end: Math.max(0, base) + chunk.start + text.length,
        hash: await sha256Hex(text),
      });
      used += text.length;
      if (truncated) break;
    }
    if (truncated) break;
  }
  return {
    evidence: all,
    targetHash: await sha256Hex(all.map(row => `${row.writingId}:${row.text}`).join('\n')),
    targetVersions: versions,
    truncated,
  };
}

async function referenceEvidence(
  projectId: string,
  lensIds: readonly string[],
  targetText: string,
): Promise<{ links: ProjectReferenceLink[]; byLens: Map<string, ReferenceEvidence[]>; versions: JudgeRun['sourceVersions'] }> {
  const requested = new Set(lensIds);
  const links = (await db.projectReferenceLinks.where('projectId').equals(projectId).toArray())
    .filter(link => link.active && link.status === 'ready' && requested.has(link.lensId));
  if (links.length !== requested.size) throw new Error('reference-lens-not-authorized');
  const byLens = new Map<string, ReferenceEvidence[]>();
  const versions: JudgeRun['sourceVersions'] = [];
  for (const link of links) {
    const [document, lens] = await Promise.all([
      db.referenceDocuments.get(link.documentId),
      db.referenceLenses.get(link.lensId),
    ]);
    if (!document || document.status !== 'ready' || !lens || lens.documentId !== document.id) continue;
    if (document.sha256 !== link.documentHash || document.version !== link.documentVersion) continue;
    const allowed = new Set(lens.sectionIds);
    const sections = (await db.referenceSections.where('documentId').equals(document.id).sortBy('order'))
      .filter(section => allowed.has(section.id));
    if (!sections.length) throw new Error('reference-lens-empty');
    const candidates = await Promise.all(sections.map(async section => {
      const text = section.text.slice(0, SOURCE_CHUNK);
      return {
        id: `reference:${lens.id}:${section.id}`,
        text,
        // The receipt fingerprints exactly what may leave the machine, not
        // the longer local section from which this bounded fragment came.
        hash: await sha256Hex(text),
        document,
        lens,
        section,
      };
    }));
    byLens.set(lens.id, selectEvidence(candidates, targetText, REFERENCE_LIMIT_PER_LENS));
    versions.push({
      documentId: document.id,
      documentHash: document.sha256,
      documentVersion: document.version,
      lensId: lens.id,
      lensUpdatedAt: lens.updatedAt,
    });
  }
  return { links, byLens, versions };
}

async function internalEvidence(input: RunJudgeInput, targetText: string): Promise<InternalEvidence[]> {
  const candidates: Array<Omit<InternalEvidence, 'hash'>> = [];
  const allWritings = (await db.writings.where('projectId').equals(input.projectId).toArray()).sort(compareManuscriptOrder);
  const currentIndex = allWritings.findIndex(row => row.id === input.writing.id);
  const allowedWritingIds = new Set<string>();
  if (input.mode === 'reader') {
    for (const row of allWritings.slice(0, Math.max(0, currentIndex))) allowedWritingIds.add(row.id);
  } else {
    if (input.context.previousWritings) {
      for (const row of allWritings.slice(0, Math.max(0, currentIndex))) allowedWritingIds.add(row.id);
    }
    for (const id of input.context.selectedWritingIds) {
      if (id !== input.writing.id) allowedWritingIds.add(id);
    }
  }
  for (const row of allWritings) {
    if (!allowedWritingIds.has(row.id)) continue;
    const plain = stripHtml(row.content);
    for (const [index, chunk] of splitAtBoundaries(plain, SOURCE_CHUNK).entries()) {
      candidates.push({
        id: `internal:writings:${row.id}:${index + 1}`,
        engineId: 'writings',
        entityId: row.id,
        title: row.title,
        text: chunk.text,
        start: chunk.start,
        end: chunk.end,
      });
    }
  }
  if (input.context.codex && input.mode !== 'reader') {
    const rows = await db.codexEntries.where('projectId').equals(input.projectId).toArray();
    for (const row of rows) {
      const text = [row.title, Object.values(row.fields).join('\n'), stripHtml(row.content)].filter(Boolean).join('\n');
      for (const [index, chunk] of splitAtBoundaries(text, SOURCE_CHUNK).entries()) {
        candidates.push({ id: `internal:codex:${row.id}:${index + 1}`, engineId: 'codex', entityId: row.id, title: row.title, ...chunk });
      }
    }
  }
  if (input.context.outline && input.mode !== 'reader') {
    const rows = await db.outlineBeats.where('projectId').equals(input.projectId).sortBy('order');
    for (const row of rows) {
      const text = [row.title, row.description].filter(Boolean).join('\n');
      candidates.push({ id: `internal:outline:${row.id}:1`, engineId: 'outline', entityId: row.id, title: row.title, text, start: 0, end: text.length });
    }
  }
  if (input.context.timeline && input.mode !== 'reader') {
    const rows = await db.timelineEvents.where('projectId').equals(input.projectId).sortBy('order');
    for (const row of rows) {
      const text = [row.title, row.date, row.lane, row.description].filter(Boolean).join('\n');
      candidates.push({ id: `internal:timeline:${row.id}:1`, engineId: 'timeline', entityId: row.id, title: row.title, text, start: 0, end: text.length });
    }
  }
  const withHashes: InternalEvidence[] = await Promise.all(candidates.map(async row => ({
    ...row,
    hash: await sha256Hex(row.text),
  })));
  return selectEvidence(withHashes, targetText, INTERNAL_LIMIT);
}

function modeInstruction(mode: JudgeMode): string {
  if (mode === 'questions') {
    return 'Ask precise Socratic questions. Do not solve, rewrite, or include suggestions. kind must describe the decision being questioned.';
  }
  if (mode === 'reader') {
    return 'Model the reader at this exact point. kind must be one of knows, suspects, promised, open. Never use knowledge outside the provided earlier evidence.';
  }
  if (mode === 'story-state') {
    return 'Debug story state without inventing. kind must be one of confirmed, hypothesis, contradiction, missing, not-applicable.';
  }
  return 'Critique decisions through the named lens and/or continuity. Never score quality. A suggestion is optional and must be a minimal before/after replacement.';
}

function promptFor(
  input: RunJudgeInput,
  target: TargetEvidence[],
  references: ReferenceEvidence[],
  internal: InternalEvidence[],
): { system: string; user: string } {
  const lens = references[0]?.lens;
  const approvedCriteria = lens?.criteria.filter(criterion => criterion.approved) ?? [];
  const system = [
    'You are Judge, a grounded creative-development reader inside a private writing app.',
    modeInstruction(input.mode),
    'Use only the evidence supplied. Every claim must point to an evidence ID that exists.',
    'Quote the target exactly, including punctuation, so the app can navigate back to it.',
    'If you cite a reference or internal source, quote an exact substring of that evidence.',
    'State uncertainty and context limits. Do not mention evidence that is not present.',
    `Write observations in ${input.outputLanguage || 'the language of the target text'}.`,
    'Return JSON only: {"findings":[{"targetEvidenceId":"...","quote":"exact target quote","kind":"...","observation":"...","principle":"...","sourceEvidenceId":"optional","sourceQuote":"exact optional quote","internalEvidenceId":"optional","internalQuote":"exact optional quote","confidence":"low|medium|high","contextLimits":"...","suggestion":{"before":"exact target text","after":"replacement","rationale":"..."}}]}.',
    input.mode === 'questions' ? 'Omit suggestion for every finding.' : '',
  ].filter(Boolean).join('\n');
  const user = JSON.stringify({
    mode: input.mode,
    scope: input.scope,
    lens: lens ? {
      id: lens.id,
      name: lens.name,
      approvedCriteria: approvedCriteria.map(criterion => ({
        text: criterion.text,
        sourceSectionId: criterion.sourceSectionId,
      })),
    } : null,
    target: target.map(row => ({ id: row.id, writingId: row.writingId, title: row.title, text: row.text })),
    referenceEvidence: references.map(row => ({
      id: row.id,
      document: row.document.name,
      page: row.section.page,
      section: row.section.heading,
      text: row.text,
    })),
    internalEvidence: internal.map(row => ({
      id: row.id,
      engineId: row.engineId,
      entityId: row.entityId,
      title: row.title,
      text: row.text,
    })),
  });
  return { system, user };
}

async function streamCompletion(
  route: AiRouteSelection,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      fn();
    };
    const handle = chatStream({
      connectionId: route.connectionId,
      modelId: route.modelId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 3_500,
      disableThinking: true,
    }, event => {
      if (event.type === 'delta') text += event.text;
      else if (event.type === 'done') finish(() => resolve(text));
      else if (event.type === 'cancelled') finish(() => reject(new DOMException('Judge cancelled', 'AbortError')));
      else if (event.type === 'error') finish(() => reject(new Error(event.message)));
    });
    const abort = () => {
      handle.cancel();
      finish(() => reject(new DOMException('Judge cancelled', 'AbortError')));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function confidenceValue(value: unknown): JudgeConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function suggestionValue(value: unknown, targetText: string): JudgeSuggestion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const before = stringValue(row.before);
  const after = typeof row.after === 'string' ? row.after : undefined;
  const rationale = stringValue(row.rationale);
  if (!before || after === undefined || !rationale || !targetText.includes(before)) return undefined;
  return { before, after, rationale };
}

function closestExactIndex(container: string, quote: string, preferredStart?: number): number {
  let cursor = container.indexOf(quote);
  if (cursor < 0 || preferredStart === undefined) return cursor;
  let closest = cursor;
  let distance = Math.abs(cursor - preferredStart);
  while (cursor >= 0) {
    const next = container.indexOf(quote, cursor + Math.max(1, quote.length));
    if (next < 0) break;
    const nextDistance = Math.abs(next - preferredStart);
    if (nextDistance < distance) {
      closest = next;
      distance = nextDistance;
    }
    cursor = next;
  }
  return closest;
}

function exactLocation(container: string, quote: string, preferredStart?: number): { start: number; end: number } | null {
  const direct = closestExactIndex(container, quote, preferredStart);
  if (direct >= 0) return { start: direct, end: direct + quote.length };
  // Models occasionally normalize a run of spaces. Accept that only while
  // preserving an exact mapping back to the original characters.
  const foldedQuote = quote.replace(/\s+/g, ' ').trim();
  if (!foldedQuote) return null;
  let folded = '';
  const map: number[] = [];
  let inWhitespace = false;
  for (let index = 0; index < container.length; index++) {
    const char = container[index];
    if (/\s/.test(char)) {
      if (inWhitespace) continue;
      inWhitespace = true;
      folded += ' ';
      map.push(index);
    } else {
      inWhitespace = false;
      folded += char;
      map.push(index);
    }
  }
  const foldedPreferred = preferredStart === undefined
    ? undefined
    : map.findIndex(original => original >= preferredStart);
  const found = closestExactIndex(
    folded,
    foldedQuote,
    foldedPreferred === -1 ? folded.length : foldedPreferred,
  );
  if (found < 0) return null;
  return { start: map[found], end: (map[found + foldedQuote.length - 1] ?? map[found]) + 1 };
}

async function findingFingerprint(
  finding: Pick<JudgeFinding, 'writingId' | 'lensId' | 'kind' | 'anchor' | 'reference' | 'internal'>,
): Promise<string> {
  return sha256Hex([
    finding.writingId,
    finding.lensId ?? '',
    finding.kind,
    foldJudgeText(finding.anchor.quote),
    finding.reference?.sectionId ?? '',
    finding.reference?.quote ?? '',
    finding.internal?.entityId ?? '',
    finding.internal?.quote ?? '',
  ].join('|'));
}

async function validateFindings(
  input: RunJudgeInput,
  runId: string,
  lensId: string | undefined,
  raw: string,
  target: TargetEvidence[],
  references: ReferenceEvidence[],
  internal: InternalEvidence[],
): Promise<{ valid: JudgeFinding[]; invalid: number }> {
  const parsed = parseJsonFromModel<ModelEnvelope>(raw);
  if (!parsed || !Array.isArray(parsed.findings)) throw new SyntaxError('Judge output has no findings array');
  const targetById = new Map(target.map(row => [row.id, row]));
  const referenceById = new Map(references.map(row => [row.id, row]));
  const internalById = new Map(internal.map(row => [row.id, row]));
  const valid: JudgeFinding[] = [];
  let invalid = 0;
  for (const candidate of parsed.findings as ModelFinding[]) {
    if (!candidate || typeof candidate !== 'object') {
      invalid++;
      continue;
    }
    const targetRow = targetById.get(stringValue(candidate.targetEvidenceId) ?? '');
    const quote = stringValue(candidate.quote);
    const observation = stringValue(candidate.observation);
    if (!targetRow || !quote || !observation) {
      invalid++;
      continue;
    }
    const located = exactLocation(targetRow.text, quote);
    if (!located) {
      invalid++;
      continue;
    }
    const kind = stringValue(candidate.kind) ?? (input.mode === 'questions' ? 'question' : 'observation');
    if (
      input.mode === 'reader' && !['knows', 'suspects', 'promised', 'open'].includes(kind)
      || input.mode === 'story-state' && !['confirmed', 'hypothesis', 'contradiction', 'missing', 'not-applicable'].includes(kind)
    ) {
      invalid++;
      continue;
    }

    let reference: JudgeReferenceCitation | undefined;
    const sourceId = stringValue(candidate.sourceEvidenceId);
    if (sourceId) {
      const source = referenceById.get(sourceId);
      const sourceQuote = stringValue(candidate.sourceQuote);
      if (!source || !sourceQuote || !exactLocation(source.text, sourceQuote)) {
        invalid++;
        continue;
      }
      reference = {
        documentId: source.document.id,
        documentName: source.document.name,
        documentHash: source.document.sha256,
        sectionId: source.section.id,
        sectionHeading: source.section.heading,
        page: source.section.page,
        quote: sourceQuote,
      };
    }
    // A lens-attributed observation without a citeable piece of that lens is
    // not "best effort"; it is ungrounded and therefore discarded.
    if (lensId && references.length > 0 && !reference) {
      invalid++;
      continue;
    }
    const principle = stringValue(candidate.principle);
    if (lensId && references.length > 0 && !principle) {
      invalid++;
      continue;
    }

    let internalCitation: JudgeInternalCitation | undefined;
    const internalId = stringValue(candidate.internalEvidenceId);
    if (internalId) {
      const source = internalById.get(internalId);
      const internalQuote = stringValue(candidate.internalQuote);
      const internalLocation = source && internalQuote ? exactLocation(source.text, internalQuote) : null;
      if (!source || !internalQuote || !internalLocation) {
        invalid++;
        continue;
      }
      internalCitation = {
        engineId: source.engineId,
        entityId: source.entityId,
        title: source.title,
        quote: internalQuote,
        start: source.start + internalLocation.start,
        end: source.start + internalLocation.end,
      };
    }
    if (references.length === 0 && internal.length > 0 && !internalCitation) {
      invalid++;
      continue;
    }

    const now = Date.now();
    const partial: Omit<JudgeFinding, 'id' | 'evidenceFingerprint'> = {
      runId,
      projectId: input.projectId,
      writingId: targetRow.writingId,
      lensId,
      mode: input.mode,
      kind,
      anchor: {
        quote: targetRow.text.slice(located.start, located.end),
        start: targetRow.start + located.start,
        end: targetRow.start + located.end,
      },
      observation,
      principle,
      reference,
      internal: internalCitation,
      confidence: confidenceValue(candidate.confidence),
      contextLimits: stringValue(candidate.contextLimits) ?? 'Only the displayed evidence was reviewed.',
      suggestion: input.mode === 'questions' ? undefined : suggestionValue(candidate.suggestion, targetRow.text),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const evidenceFingerprint = await findingFingerprint(partial);
    valid.push({ ...partial, id: generateId('finding'), evidenceFingerprint });
  }
  return { valid, invalid };
}

async function payloadReceipt(
  route: JudgeRouteInfo,
  target: TargetEvidence[],
  references: ReferenceEvidence[],
  internal: InternalEvidence[],
  truncated: boolean,
  editorialContext = '',
): Promise<JudgePayloadReceipt> {
  const all = [...target, ...references, ...internal];
  const disclosed = {
    routeLocality: route.locality,
    routeConnectionId: route.route.connectionId,
    routeModelId: route.route.modelId,
    routeName: route.connectionName,
    targetCharacters: target.reduce((sum, row) => sum + row.text.length, 0),
    referenceCharacters: references.reduce((sum, row) => sum + row.text.length, 0),
    internalCharacters: internal.reduce((sum, row) => sum + row.text.length, 0) + editorialContext.length,
    targetTruncated: truncated,
    evidence: [
      ...all.map(row => ({ id: row.id, hash: row.hash, characters: row.text.length })),
      { id: 'editorial-profile', hash: await sha256Hex(editorialContext), characters: editorialContext.length },
    ],
  };
  return {
    ...disclosed,
    disclosureFingerprint: await sha256Hex(JSON.stringify(disclosed)),
  };
}

export async function runJudge(input: RunJudgeInput): Promise<RunJudgeResult> {
  const editorialContext = await buildProjectEditorialContext(input.projectId);
  if (input.scope === 'selection' && !input.selection?.text.trim()) throw new Error('judge-selection-empty');
  if (input.sourceMode === 'reference' && input.lensIds.length === 0) throw new Error('judge-reference-required');
  const routeInfo = await getJudgeRouteInfo(input.projectId);
  if (routeInfo.locality === 'remote' && !routeInfo.remoteConsentPolicy && !input.allowRemote) {
    throw new Error('judge-remote-consent-required');
  }
  input.signal?.throwIfAborted();
  input.onStage?.('collecting', 0, 1);
  const target = await targetEvidence(input);
  const targetText = target.evidence.map(row => row.text).join('\n');
  const shouldUseReferences = input.sourceMode !== 'continuity' && input.lensIds.length > 0;
  const shouldUseInternal = input.sourceMode !== 'reference' || input.mode === 'reader' || input.mode === 'story-state';
  const [references, internal] = await Promise.all([
    shouldUseReferences
      ? referenceEvidence(input.projectId, input.lensIds, targetText)
      : Promise.resolve({ links: [], byLens: new Map<string, ReferenceEvidence[]>(), versions: [] }),
    shouldUseInternal ? internalEvidence(input, targetText) : Promise.resolve([]),
  ]);
  input.signal?.throwIfAborted();
  input.onStage?.('collecting', 1, 1);

  const lensRuns: Array<{ lensId?: string; references: ReferenceEvidence[] }> = shouldUseReferences
    ? input.lensIds.flatMap(lensId => references.byLens.has(lensId)
      ? [{ lensId, references: references.byLens.get(lensId)! }]
      : [])
    : [{ references: [] }];
  if (!lensRuns.length) lensRuns.push({ references: [] });
  const allReferenceEvidence = [...references.byLens.values()].flat();
  const receipt = await payloadReceipt(
    routeInfo,
    target.evidence,
    allReferenceEvidence,
    internal,
    target.truncated,
    editorialContext,
  );
  if (
    routeInfo.locality === 'remote'
    && !routeInfo.remoteConsentPolicy
    && input.allowRemote
    && input.expectedDisclosureFingerprint !== receipt.disclosureFingerprint
  ) {
    throw new Error('judge-disclosure-stale');
  }
  const runId = generateId('judge');
  const run: JudgeRun = {
    id: runId,
    projectId: input.projectId,
    writingId: input.writing.id,
    mode: input.mode,
    scope: input.scope,
    sourceMode: input.sourceMode,
    selectedLensIds: lensRuns.flatMap(row => row.lensId ? [row.lensId] : []),
    context: { ...input.context, selectedWritingIds: [...input.context.selectedWritingIds] },
    targetHash: target.targetHash,
    targetVersions: target.targetVersions,
    sourceVersions: references.versions,
    payload: receipt,
    status: 'running',
    createdAt: Date.now(),
  };
  await db.judgeRuns.add(run);

  try {
    const findings: JudgeFinding[] = [];
    let invalidFindings = 0;
    for (const [index, lensRun] of lensRuns.entries()) {
      input.signal?.throwIfAborted();
      input.onStage?.('analysing', index, lensRuns.length);
      const prompt = promptFor(input, target.evidence, lensRun.references, internal);
      const raw = await streamCompletion(routeInfo.route, `${prompt.system}\n${editorialContext}`, prompt.user, input.signal);
      const validated = await validateFindings(
        input,
        runId,
        lensRun.lensId,
        raw,
        target.evidence,
        lensRun.references,
        internal,
      );
      findings.push(...validated.valid);
      invalidFindings += validated.invalid;
    }
    input.onStage?.('saving', 0, 1);
    if (!findings.length && invalidFindings > 0) throw new Error('judge-output-unverifiable');
    const dismissed = new Set(
      (await db.judgeFindings.where('projectId').equals(input.projectId).filter(row => row.status === 'intentional').toArray())
        .map(row => row.evidenceFingerprint),
    );
    const visibleFindings = findings.filter(finding => !dismissed.has(finding.evidenceFingerprint));
    const completedAt = Date.now();
    await db.transaction('rw', [db.judgeRuns, db.judgeFindings], async () => {
      if (visibleFindings.length) await db.judgeFindings.bulkAdd(visibleFindings);
      await db.judgeRuns.update(runId, { status: 'complete', completedAt });
    });
    input.onStage?.('saving', 1, 1);
    return { run: { ...run, status: 'complete', completedAt }, findings: visibleFindings, invalidFindings };
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === 'AbortError';
    await db.judgeRuns.update(runId, {
      status: cancelled ? 'cancelled' : 'error',
      error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
      completedAt: Date.now(),
    });
    throw error;
  }
}

export async function listJudgeRuns(projectId: string, writingId: string): Promise<JudgeRun[]> {
  return db.judgeRuns
    .where('writingId')
    .equals(writingId)
    .filter(run => run.projectId === projectId)
    .reverse()
    .sortBy('createdAt');
}

export async function listJudgeFindings(runId: string): Promise<JudgeFinding[]> {
  return db.judgeFindings.where('runId').equals(runId).sortBy('createdAt');
}

export async function dismissJudgeFinding(findingId: string): Promise<void> {
  await db.judgeFindings.update(findingId, { status: 'intentional', updatedAt: Date.now() });
}

export async function assessJudgeRunFreshness(
  run: JudgeRun,
  contentOverrides: Readonly<Record<string, string>> = {},
): Promise<JudgeRunFreshness> {
  const reasons = new Set<JudgeRunFreshness['reasons'][number]>();
  const profileEvidence = run.payload.evidence.find(row => row.id === 'editorial-profile');
  if (profileEvidence && profileEvidence.hash !== await sha256Hex(await buildProjectEditorialContext(run.projectId))) reasons.add('profile-changed');
  for (const target of run.targetVersions) {
    const override = contentOverrides[target.writingId];
    const row = override === undefined ? await db.writings.get(target.writingId) : undefined;
    const text = override === undefined ? (row ? stripHtml(row.content) : '') : stripHtml(override);
    if (!row && override === undefined || await sha256Hex(text) !== target.contentHash) reasons.add('target-changed');
  }
  for (const source of run.sourceVersions) {
    const [document, lens] = await Promise.all([
      db.referenceDocuments.get(source.documentId),
      db.referenceLenses.get(source.lensId),
    ]);
    if (!document) reasons.add('source-missing');
    else if (document.sha256 !== source.documentHash || document.version !== source.documentVersion) reasons.add('source-versioned');
    if (!lens) reasons.add('source-missing');
    else if (lens.updatedAt !== source.lensUpdatedAt) reasons.add('lens-changed');
  }
  return { stale: reasons.size > 0, reasons: [...reasons] };
}

export async function buildJudgeDisclosure(input: Omit<RunJudgeInput, 'allowRemote' | 'expectedDisclosureFingerprint' | 'signal' | 'onStage'>): Promise<{
  route: JudgeRouteInfo;
  summary: JudgePayloadReceipt;
}> {
  const route = await getJudgeRouteInfo(input.projectId);
  const target = await targetEvidence(input);
  const targetText = target.evidence.map(row => row.text).join('\n');
  const references = input.sourceMode === 'continuity'
    ? { byLens: new Map<string, ReferenceEvidence[]>() }
    : await referenceEvidence(input.projectId, input.lensIds, targetText);
  const internal = input.sourceMode === 'reference' && input.mode !== 'reader' && input.mode !== 'story-state'
    ? []
    : await internalEvidence(input, targetText);
  return {
    route,
    summary: await payloadReceipt(route, target.evidence, [...references.byLens.values()].flat(), internal, target.truncated, await buildProjectEditorialContext(input.projectId)),
  };
}

/**
 * Read-only plan used by diagnostics and contract tests. It exposes identities
 * and byte counts, never the private fragment text itself.
 */
export async function inspectJudgeEvidencePlan(
  input: Omit<RunJudgeInput, 'allowRemote' | 'expectedDisclosureFingerprint' | 'signal' | 'onStage'>,
): Promise<{
  targetWritingIds: string[];
  internal: Array<{ engineId: string; entityId: string; title: string; hash: string }>;
  references: Array<{ lensId: string; documentId: string; sectionId: string; hash: string }>;
  targetTruncated: boolean;
}> {
  const target = await targetEvidence(input);
  const targetText = target.evidence.map(row => row.text).join('\n');
  const references = input.sourceMode === 'continuity'
    ? { byLens: new Map<string, ReferenceEvidence[]>() }
    : await referenceEvidence(input.projectId, input.lensIds, targetText);
  const internal = input.sourceMode === 'reference' && input.mode !== 'reader' && input.mode !== 'story-state'
    ? []
    : await internalEvidence(input, targetText);
  return {
    targetWritingIds: [...new Set(target.evidence.map(row => row.writingId))],
    internal: internal.map(row => ({
      engineId: row.engineId,
      entityId: row.entityId,
      title: row.title,
      hash: row.hash,
    })),
    references: [...references.byLens.values()].flat().map(row => ({
      lensId: row.lens.id,
      documentId: row.document.id,
      sectionId: row.section.id,
      hash: row.hash,
    })),
    targetTruncated: target.truncated,
  };
}
