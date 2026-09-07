import { db } from '@/db';
import * as projectOps from '@/db/operations';
import { callAi } from '@/services/aiService';
import { buildProjectEditorialContext } from '@/services/editorialProfile';
import { searchProjectContent } from '@/services/projectSearchIndex';
import {
  canExportPdf,
  downloadBlobFile,
  downloadTextFile,
  exportHtmlPdf,
  renderPublishingHtml,
  renderPublishingMarkdown,
  sanitizeFilename,
} from '@/engines/writings/manuscriptExport';
import {
  composePublishingDocument,
  publishingSectionWordCount,
  type PublishingDocument,
} from '@/engines/writings/publishingDocument';
import { compareManuscriptOrder } from '@/engines/writings/chapterOrder';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import { generateId } from '@/utils/idGenerator';
import { stripHtml } from '@/utils/text';
import { t } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';
import type { Project, ProjectMode, Writing } from '@/types';
import type {
  Citation,
  ConversionReceipt,
  EntityLink,
  PublishingFormat,
  PublishingProfile,
  PublishingSelectionMode,
} from '@/types/projectTools';

export interface ProjectRecipe {
  id: string;
  name: string;
  description: string;
  mode: ProjectMode;
  enabledEngines: string[];
  engineOrder: string[];
  custom?: boolean;
}

export interface GroundedAiPrivacy {
  enabled: boolean;
  allowRemoteRequests: boolean;
  includeDrafts: boolean;
  includeResearch: boolean;
  maxContextCharacters: number;
}

export interface GroundedAiResult {
  answer: string;
  sources: Array<{ id: string; engineId: string; title: string }>;
}

const TEMPLATE_SETTING = 'project-tools.templates';
const AI_PRIVACY_PREFIX = 'project-tools.ai-privacy.';

export const BUILT_IN_RECIPES: ProjectRecipe[] = [
  {
    id: 'recipe-novel',
    name: 'Novel production',
    description: 'Draft, structure, characters, continuity, and revision tools.',
    mode: 'novelist',
    enabledEngines: ['writings', 'outline', 'codex', 'timeline', 'character-arc', 'relationships', 'seeds', 'writing-stats', 'annotations', 'notes'],
    engineOrder: ['writings', 'outline', 'codex', 'timeline', 'character-arc', 'relationships', 'seeds', 'writing-stats', 'annotations', 'notes'],
  },
  {
    id: 'recipe-research',
    name: 'Research dossier',
    description: 'Capture sources, map facts, annotate evidence, and draft findings.',
    mode: 'reporter',
    enabledEngines: ['scrapper', 'notes', 'codex', 'timeline', 'biography', 'relationships', 'board', 'writings', 'annotations'],
    engineOrder: ['scrapper', 'notes', 'codex', 'timeline', 'biography', 'relationships', 'board', 'writings', 'annotations'],
  },
  {
    id: 'recipe-screen',
    name: 'Screen and stage',
    description: 'Scene-first planning with cast, storyboard, beats, and dialogue.',
    mode: 'playwright',
    enabledEngines: ['dialog-scene', 'outline', 'codex', 'storyboard', 'character-arc', 'relationships', 'seeds', 'gallery', 'annotations'],
    engineOrder: ['dialog-scene', 'outline', 'codex', 'storyboard', 'character-arc', 'relationships', 'seeds', 'gallery', 'annotations'],
  },
  {
    id: 'recipe-video',
    name: 'Video production',
    description: 'Research, script, visuals, shot planning, and teleprompter.',
    mode: 'content-creator',
    enabledEngines: ['scrapper', 'video-planner', 'storyboard', 'gallery', 'notes', 'writings', 'timeline'],
    engineOrder: ['scrapper', 'video-planner', 'storyboard', 'gallery', 'notes', 'writings', 'timeline'],
  },
];

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getProjectRecipes(): Promise<ProjectRecipe[]> {
  const custom = parseJson<ProjectRecipe[]>(
    await projectOps.getSetting(TEMPLATE_SETTING),
    [],
  );
  return [...BUILT_IN_RECIPES, ...custom.map(recipe => ({ ...recipe, custom: true }))];
}

export async function saveProjectAsRecipe(
  project: Project,
  name: string,
  description: string,
): Promise<ProjectRecipe> {
  const custom = parseJson<ProjectRecipe[]>(
    await projectOps.getSetting(TEMPLATE_SETTING),
    [],
  );
  const recipe: ProjectRecipe = {
    id: generateId('recipe'),
    name: name.trim() || project.title,
    description: description.trim(),
    mode: project.mode,
    enabledEngines: [...new Set(project.enabledEngines)],
    engineOrder: [...new Set(project.engineOrder)],
    custom: true,
  };
  await projectOps.setSetting(TEMPLATE_SETTING, JSON.stringify([...custom, recipe]));
  return recipe;
}

export async function deleteCustomRecipe(recipeId: string): Promise<void> {
  const custom = parseJson<ProjectRecipe[]>(
    await projectOps.getSetting(TEMPLATE_SETTING),
    [],
  );
  await projectOps.setSetting(
    TEMPLATE_SETTING,
    JSON.stringify(custom.filter(recipe => recipe.id !== recipeId)),
  );
}

export async function applyProjectRecipe(
  projectId: string,
  recipe: ProjectRecipe,
  mode: 'merge' | 'replace' = 'merge',
): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Project not found');
  const enabledEngines = mode === 'replace'
    ? [...recipe.enabledEngines]
    : [...new Set([...project.enabledEngines, ...recipe.enabledEngines])];
  const orderSource = mode === 'replace'
    ? recipe.engineOrder
    : [...project.engineOrder, ...recipe.engineOrder];
  const engineOrder = [...new Set(orderSource)].filter(id => enabledEngines.includes(id));
  await projectOps.updateProject(projectId, {
    mode: recipe.mode,
    enabledEngines,
    engineOrder: [...engineOrder, ...enabledEngines.filter(id => !engineOrder.includes(id))],
  });
}

export async function getCitations(projectId: string): Promise<Citation[]> {
  return db.citations.where('projectId').equals(projectId).reverse().sortBy('updatedAt');
}

export async function saveCitation(
  value: Omit<Citation, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<Citation> {
  return db.transaction('rw', db.projects, db.citations, db.snapshots, async () => {
    if (!await db.projects.get(value.projectId)) throw new Error('Project not found');
    const existing = value.id ? await db.citations.get(value.id) : undefined;
    if (value.id && !existing) throw new Error('Citation no longer exists');
    if (existing && existing.projectId !== value.projectId) throw new Error('Citation project cannot change');
    if (existing?.researchEvidence?.length && (existing.url !== value.url || existing.snapshotId !== value.snapshotId)) {
      throw new Error('A source with evidence cannot be replaced; create a separate citation');
    }
    if (value.snapshotId) {
      const snapshot = await db.snapshots.get(value.snapshotId);
      if (!snapshot || snapshot.projectId !== value.projectId) throw new Error('Citation source scope mismatch');
    }
    const now = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
    const citation: Citation = {
      ...existing,
      ...value,
      id: existing?.id ?? generateId('cite'),
      // Evidence is changed only through its own scoped, versioned service.
      // Read it inside this transaction; stale citation forms cannot overwrite it.
      researchEvidence: existing?.researchEvidence,
      authors: value.authors.filter(Boolean),
      tags: value.tags.filter(Boolean),
      writingIds: [...new Set(value.writingIds)],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.citations.put(citation);
    return citation;
  });
}

export async function citationFromSnapshot(snapshotId: string): Promise<Citation> {
  return db.transaction('rw', db.projects, db.citations, db.snapshots, async () => {
    const snapshot = await db.snapshots.get(snapshotId);
    if (!snapshot) throw new Error('Research snapshot not found');
    const existing = (await db.citations.where('projectId').equals(snapshot.projectId).toArray())
      .find(citation => citation.snapshotId === snapshotId);
    if (existing) return existing;
    return saveCitation({
      projectId: snapshot.projectId,
      title: snapshot.title || snapshot.url,
      authors: snapshot.author ? [snapshot.author] : [],
      publishedAt: snapshot.publishDate,
      accessedAt: toLocalDateKey(new Date(snapshot.preservedAt || snapshot.createdAt)),
      url: snapshot.url,
      notes: snapshot.notes,
      snapshotId: snapshot.id,
      writingIds: [],
      tags: snapshot.tags,
    });
  });
}

/** Delete precisely the source/version the author reviewed in the confirmation. */
export async function deleteCitation(id: string, guard: { projectId: string; expectedUpdatedAt: number }): Promise<void> {
  await db.transaction('rw', db.citations, async () => {
    const citation = await db.citations.get(id);
    if (!citation || citation.projectId !== guard.projectId || citation.updatedAt !== guard.expectedUpdatedAt) {
      throw new Error('Citation changed; review it before deleting');
    }
    await db.citations.delete(id);
  });
}

export interface CitationFormatLabels {
  locale: string;
  unknownAuthor: string;
  noDate: string;
  accessedLabel: string;
}

function currentCitationLabels(): CitationFormatLabels {
  return {
    locale: useLocaleStore.getState().locale,
    unknownAuthor: t('projectTools.research.unknownAuthor'),
    noDate: t('projectTools.research.noDate'),
    accessedLabel: t('projectTools.research.accessed'),
  };
}

export function formatCitation(
  citation: Citation,
  style: PublishingProfile['citationStyle'],
  labels: CitationFormatLabels = {
    locale: 'en-US',
    unknownAuthor: 'Unknown author',
    noDate: 'n.d.',
    accessedLabel: 'Accessed',
  },
): string {
  const authors = citation.authors.length ? citation.authors.join(', ') : labels.unknownAuthor;
  const year = citation.publishedAt?.slice(0, 4) || labels.noDate;
  const accessed = citation.accessedAt ? new Date(`${citation.accessedAt}T00:00:00`).toLocaleDateString(labels.locale) : '';
  if (style === 'mla') {
    return `${authors}. “${citation.title}.” ${citation.publisher ? `${citation.publisher}, ` : ''}${year}.${citation.url ? ` ${citation.url}.` : ''}${accessed ? ` ${labels.accessedLabel} ${accessed}.` : ''}`;
  }
  if (style === 'chicago') {
    return `${authors}. “${citation.title}.” ${citation.publisher ?? ''}${citation.publisher ? ', ' : ''}${year}.${citation.url ? ` ${citation.url}.` : ''}${accessed ? ` ${labels.accessedLabel} ${accessed}.` : ''}`;
  }
  return `${authors} (${year}). ${citation.title}.${citation.publisher ? ` ${citation.publisher}.` : ''}${citation.url ? ` ${citation.url}` : ''}`;
}

/** APA, MLA and Chicago all order the reference list by first author. */
export function compareCitationsForBibliography(a: Citation, b: Citation): number {
  const author = (a.authors[0] ?? '').localeCompare(b.authors[0] ?? '');
  return author !== 0 ? author : a.title.localeCompare(b.title);
}

export async function exportBibliography(
  projectId: string,
  style: PublishingProfile['citationStyle'],
  projectTitle: string,
): Promise<void> {
  const citations = await getCitations(projectId);
  const text = citations
    .sort(compareCitationsForBibliography)
    .map(citation => formatCitation(citation, style, currentCitationLabels()))
    .join('\n\n');
  downloadTextFile(
    `${projectTitle}\n${t('projectTools.research.bibliography')} (${style.toUpperCase()})\n\n${text}\n`,
    `${sanitizeFilename(projectTitle)}-bibliography-${style}.txt`,
    'text/plain',
  );
}

export async function getPublishingProfiles(projectId: string): Promise<PublishingProfile[]> {
  return db.publishingProfiles.where('projectId').equals(projectId).reverse().sortBy('updatedAt');
}

export interface NormalizedPublishingProfile extends PublishingProfile {
  selectionMode: PublishingSelectionMode;
  writingOrder: string[];
}

export interface PublishingResolution {
  profile: NormalizedPublishingProfile;
  writings: Writing[];
  missingWritingIds: string[];
  googleDocsWithoutContent: Writing[];
}

export interface PublishingArtifactLabels extends CitationFormatLabels {
  wordLabel: string;
  chapterLabel: string;
  bibliographyTitle: string;
  /** Optional so a caller that only cares about order need not supply one. */
  untitledLabel?: string;
  /** Heading over a chapter's footnotes; optional for the same reason. */
  notesLabel?: string;
  /** Heading over the chapter list; optional for the same reason. */
  tocTitle?: string;
}

export interface PublishingArtifacts {
  document: PublishingDocument;
  markdown: string;
  html: string;
  markdownFilename: string;
  htmlFilename: string;
  pdfFilename: string;
  docxFilename: string;
  epubFilename: string;
}

export type PublishingOutput = 'markdown' | 'html' | 'pdf' | 'docx' | 'epub';
export type PublishingExportReason =
  | 'no-writings'
  | 'google-docs-without-content'
  | 'pdf-unavailable'
  | 'export-failed';

export interface PublishingExportResult {
  ok: boolean;
  canceled?: boolean;
  reason?: PublishingExportReason;
  error?: string;
  missingWritingIds: string[];
  googleDocsWithoutContent: Array<{ id: string; title: string }>;
  omittedImageCount?: number;
}

function uniqueIds(ids: readonly string[] | undefined): string[] {
  return [...new Set(ids ?? [])].filter(Boolean);
}

export function normalizePublishingProfile(profile: PublishingProfile): NormalizedPublishingProfile {
  const selectedWritingIds = uniqueIds(profile.selectedWritingIds);
  return {
    ...profile,
    selectionMode: profile.selectionMode ?? (selectedWritingIds.length > 0 ? 'selected' : 'all'),
    selectedWritingIds,
    writingOrder: uniqueIds(profile.writingOrder),
  };
}

/**
 * Manuscript order — the order the Writings list is already showing.
 *
 * It delegates to `compareManuscriptOrder` rather than restating the rule,
 * because this is the order a DOCX or ePub carries its chapters in, and an
 * export that sorts differently from the list is an export whose chapters sit
 * in the wrong place in a file the writer has already sent to an editor. There
 * is no way to notice from inside the app: the list looks right, and the file
 * is somewhere else.
 *
 * The copy that used to live here read the chapter number, then `createdAt`,
 * then the id, and it agreed with the list on exactly one shape — a book whose
 * chapters are all numbered, all differently. Manuscript import made both of
 * the others ordinary:
 *
 *   UNNUMBERED writings. The list shows them after the numbered ones, most
 *   recently touched first; this sorted them oldest-created first, so an idea
 *   and a stub came out of the file in the opposite order to the list.
 *
 *   TWO WRITINGS SHARING A NUMBER, which is legal and is what an import
 *   landing beside hand-numbered chapters produces. The list breaks that tie
 *   on the id; this broke it on `createdAt` first, so the pair came out in
 *   whichever order they happened to be written in — and `importManuscript`
 *   stamps one `Date.now()` across a whole imported book, so an imported
 *   chapter 7 and a typed chapter 7 never share a creation time and the two
 *   orders never had to agree.
 */
export function defaultPublishingOrder(writings: readonly Writing[]): Writing[] {
  return [...writings].sort(compareManuscriptOrder);
}

export function resolvePublishingWritings(
  allWritings: readonly Writing[],
  rawProfile: PublishingProfile,
): PublishingResolution {
  const profile = normalizePublishingProfile(rawProfile);
  const scoped = allWritings.filter(writing => writing.projectId === profile.projectId);
  const byId = new Map(scoped.map(writing => [writing.id, writing]));
  const fallbackOrder = defaultPublishingOrder(scoped);
  const seen = new Set<string>();
  const ordered: Writing[] = [];

  for (const id of profile.writingOrder) {
    const writing = byId.get(id);
    if (writing && !seen.has(id)) {
      seen.add(id);
      ordered.push(writing);
    }
  }
  for (const writing of fallbackOrder) {
    if (!seen.has(writing.id)) ordered.push(writing);
  }

  const selected = new Set(profile.selectedWritingIds);
  const writings = profile.selectionMode === 'all'
    ? ordered
    : ordered.filter(writing => selected.has(writing.id));
  const referencedIds = uniqueIds([...profile.selectedWritingIds, ...profile.writingOrder]);
  const missingWritingIds = referencedIds.filter(id => !byId.has(id));
  const googleDocsWithoutContent = writings.filter(
    writing => Boolean(writing.isGoogleDoc) && !stripHtml(writing.content).trim(),
  );

  return { profile, writings, missingWritingIds, googleDocsWithoutContent };
}

export async function savePublishingProfile(
  value: Omit<PublishingProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<PublishingProfile> {
  const now = Date.now();
  const existing = value.id ? await db.publishingProfiles.get(value.id) : undefined;
  const profile = normalizePublishingProfile({
    ...value,
    id: value.id ?? generateId('publish'),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if (profile.selectionMode === 'selected' && profile.selectedWritingIds.length === 0) {
    throw new Error('A selected-only publishing profile must contain at least one writing.');
  }
  await db.publishingProfiles.put(profile);
  return profile;
}

export async function deletePublishingProfile(id: string): Promise<void> {
  await db.publishingProfiles.delete(id);
}

function currentPublishingLabels(format: PublishingFormat): PublishingArtifactLabels {
  return {
    ...currentCitationLabels(),
    wordLabel: t('writings.words'),
    chapterLabel: t(`projectTools.publishing.chapterLabel.${format}`),
    bibliographyTitle: t('projectTools.research.bibliography'),
    untitledLabel: t('projectTools.publishing.untitled'),
    notesLabel: t('writings.footnotes.endnotesTitle'),
    tocTitle: t('projectTools.publishing.tocTitle'),
  };
}

export function buildPublishingArtifacts(
  project: Pick<Project, 'id' | 'title' | 'footnoteStyle' | 'footnotePlacement'>,
  profile: PublishingProfile,
  writings: readonly Writing[],
  citations: readonly Citation[],
  artifactOptions: {
    labels?: PublishingArtifactLabels;
    titleOverride?: string;
    generatedAt?: number;
  } = {},
): PublishingArtifacts {
  const labels = artifactOptions.labels ?? currentPublishingLabels(profile.format);
  const documentTitle = artifactOptions.titleOverride ?? `${project.title} — ${profile.name}`;
  const compileOptions = {
    projectTitle: documentTitle,
    includeTitlePage: profile.includeTitlePage,
    includeToc: profile.includeToc ?? false,
    tocTitle: labels.tocTitle,
    includeSynopsis: profile.includeSynopsis,
    chapterLabel: labels.chapterLabel,
    untitledLabel: labels.untitledLabel,
    wordLabel: labels.wordLabel,
    notesLabel: labels.notesLabel,
    footnoteStyle: project.footnoteStyle,
    footnotePlacement: project.footnotePlacement,
    locale: labels.locale,
    generatedAt: artifactOptions.generatedAt,
  };
  const bibliography = profile.includeBibliography
    ? [...citations]
      .sort(compareCitationsForBibliography)
      .map(citation => formatCitation(citation, profile.citationStyle, labels))
    : [];
  const document = composePublishingDocument(writings, {
    ...compileOptions,
    identifier: `urn:writers-hoard:${encodeURIComponent(project.id)}:${encodeURIComponent(profile.id || profile.name)}`,
    bibliographyTitle: bibliography.length ? labels.bibliographyTitle : undefined,
    bibliography,
  });
  const markdown = renderPublishingMarkdown(document);
  const html = renderPublishingHtml(document);
  const stem = sanitizeFilename(profile.name || project.title);
  return {
    document,
    markdown,
    html,
    markdownFilename: `${stem}.md`,
    htmlFilename: `${stem}.html`,
    pdfFilename: `${stem}.pdf`,
    docxFilename: `${stem}.docx`,
    epubFilename: `${stem}.epub`,
  };
}

/**
 * The project with its footnote settings (marker style, placement), for a
 * caller that only has the id and the title (the Writings compile shortcut,
 * "export this writing"). Read from the row rather than asked of every
 * caller, so the choices made in the footnotes panel reach every export
 * the same way.
 */
async function withFootnoteStyle(
  project: Pick<Project, 'id' | 'title' | 'footnoteStyle' | 'footnotePlacement'>,
): Promise<Pick<Project, 'id' | 'title' | 'footnoteStyle' | 'footnotePlacement'>> {
  if (project.footnoteStyle !== undefined && project.footnotePlacement !== undefined) return project;
  try {
    const row = await db.projects.get(project.id);
    if (!row) return project;
    return {
      ...project,
      footnoteStyle: project.footnoteStyle ?? row.footnoteStyle,
      footnotePlacement: project.footnotePlacement ?? row.footnotePlacement,
    };
  } catch {
    // Numbers per chapter, then — the defaults every exporter already assumes.
    return project;
  }
}

export async function exportPublishingProfile(
  project: Pick<Project, 'id' | 'title' | 'footnoteStyle' | 'footnotePlacement'>,
  profile: PublishingProfile,
  output: PublishingOutput,
  artifactOptions: { titleOverride?: string; generatedAt?: number } = {},
): Promise<PublishingExportResult> {
  const allWritings = await db.writings.where('projectId').equals(project.id).toArray();
  const resolved = resolvePublishingWritings(allWritings, profile);
  const baseResult = {
    missingWritingIds: resolved.missingWritingIds,
    googleDocsWithoutContent: resolved.googleDocsWithoutContent.map(({ id, title }) => ({ id, title })),
  };
  if (resolved.writings.length === 0) {
    return { ok: false, reason: 'no-writings', ...baseResult };
  }
  if (resolved.googleDocsWithoutContent.length > 0) {
    return { ok: false, reason: 'google-docs-without-content', ...baseResult };
  }
  const citations = profile.includeBibliography ? await getCitations(project.id) : [];
  const artifacts = buildPublishingArtifacts(
    await withFootnoteStyle(project),
    profile,
    resolved.writings,
    citations,
    artifactOptions,
  );

  if (output === 'markdown') {
    downloadTextFile(artifacts.markdown, artifacts.markdownFilename, 'text/markdown');
    return { ok: true, ...baseResult };
  }
  if (output === 'html') {
    downloadTextFile(artifacts.html, artifacts.htmlFilename, 'text/html');
    return { ok: true, ...baseResult };
  }
  if (output === 'pdf' && !canExportPdf()) {
    return { ok: false, reason: 'pdf-unavailable', ...baseResult };
  }
  try {
    if (output === 'docx') {
      const { buildPublishingDocx } = await import('@/engines/writings/publishingDocx');
      const blob = await buildPublishingDocx(artifacts.document);
      downloadBlobFile(blob, artifacts.docxFilename);
      return {
        ok: true,
        omittedImageCount: artifacts.document.omittedPortableImageCount,
        ...baseResult,
      };
    }
    if (output === 'epub') {
      const { buildPublishingEpub } = await import('@/engines/writings/publishingEpub');
      const blob = await buildPublishingEpub(artifacts.document);
      downloadBlobFile(blob, artifacts.epubFilename);
      return {
        ok: true,
        omittedImageCount: artifacts.document.omittedPortableImageCount,
        ...baseResult,
      };
    }
    const result = await exportHtmlPdf(artifacts.html, artifacts.pdfFilename);
    return result.ok
      ? { ok: true, ...baseResult }
      : { ok: false, canceled: result.canceled, reason: 'export-failed', error: result.error, ...baseResult };
  } catch (error) {
    return {
      ok: false,
      reason: 'export-failed',
      error: error instanceof Error ? error.message : String(error),
      ...baseResult,
    };
  }
}

// ---------------------------------------------------------------------------
// Publishing preview — the exported artifacts, bounded
// ---------------------------------------------------------------------------
//
// Every export used to be blind: the writer pressed PDF and learned about the
// heading face, the dropped images or the wrong chapter order from the editor
// they had already mailed. The preview answers that from the SAME
// `buildPublishingArtifacts` the exporters run — not a second compile that can
// drift — with two bounds so a 400-chapter novel stays interactive.

/** Pieces whose body is compiled in full. The rest are outlined by heading. */
export const PUBLISHING_PREVIEW_BODY_LIMIT = 8;
/** Pieces whose heading is resolved. Past this only a count is reported. */
export const PUBLISHING_PREVIEW_OUTLINE_LIMIT = 60;
/** A standard manuscript page: 12pt, double spaced, about 250 words. */
export const PUBLISHING_WORDS_PER_PAGE = 250;

/**
 * What the selection actually carries. A format caveat is only worth a line
 * when the manuscript can trigger it, so each one is gated on a probe here.
 */
export interface PublishingPreviewContent {
  images: boolean;
  links: boolean;
  tables: boolean;
  mergedCells: boolean;
  sceneBreaks: boolean;
  headings: boolean;
  deepHeadings: boolean;
}

// Probed on the stored bodies rather than on the compiled IR: a table in
// chapter 300 has to raise its caveat even though only chapter 1 is rendered.
const CONTENT_PROBES: ReadonlyArray<readonly [keyof PublishingPreviewContent, RegExp]> = [
  ['images', /<img\b/i],
  ['links', /<a\b[^>]*\bhref=/i],
  ['tables', /<table\b/i],
  ['mergedCells', /<t[dh]\b[^>]*\b(?:colspan|rowspan)=/i],
  ['sceneBreaks', /<hr\b/i],
  ['headings', /<h[1-6]\b/i],
  ['deepHeadings', /<h[4-6]\b/i],
];

// One scan decides whether the seven above are worth running at all: plain
// prose carries none of these tags, and a long manuscript is mostly prose.
const CONTENT_PROBE_GATE = /<(?:a|h[1-6]|hr|img|t[dh]|table)\b/i;

function probePublishingContent(writings: readonly Writing[]): PublishingPreviewContent {
  const found: PublishingPreviewContent = {
    images: false,
    links: false,
    tables: false,
    mergedCells: false,
    sceneBreaks: false,
    headings: false,
    deepHeadings: false,
  };
  let pending = CONTENT_PROBES.length;
  for (const writing of writings) {
    if (!CONTENT_PROBE_GATE.test(writing.content)) continue;
    for (const [feature, probe] of CONTENT_PROBES) {
      if (found[feature] || !probe.test(writing.content)) continue;
      found[feature] = true;
      pending -= 1;
    }
    // Every caveat has already earned its line; the remaining bodies cannot
    // change the answer, so a long manuscript stops costing anything here.
    if (pending === 0) break;
  }
  return found;
}

export interface PublishingPreviewPiece {
  id: string;
  /** The heading exactly as the exported file will carry it. */
  title: string;
  synopsis?: string;
  wordCount: number;
  /** Body as Markdown, HTML and PDF consume it — images intact. */
  html: string;
  /** Body as DOCX and ePub consume it — images removed. */
  portableHtml: string;
  /** False when only the heading was compiled, to bound the preview's cost. */
  bodyCompiled: boolean;
}

export interface PublishingPreview {
  /** The safe IR itself, so a pane can render document-level parts verbatim. */
  document: PublishingDocument;
  pieces: PublishingPreviewPiece[];
  /** Selected pieces past the outline limit: counted, never listed. */
  unlistedPieceCount: number;
  /** Pieces in the whole selection, not just the previewed ones. */
  pieceCount: number;
  /** Words in the whole selection — the number the title page will print. */
  wordCount: number;
  pageEstimate: number;
  content: PublishingPreviewContent;
  missingWritingIds: string[];
  googleDocsWithoutContent: Array<{ id: string; title: string }>;
}

/**
 * Compile what `exportPublishingProfile` would compile, bounded.
 *
 * The selection, the order, the headings, the synopses, the bibliography and
 * the title page all come out of `buildPublishingArtifacts`, so the preview
 * cannot disagree with the file: there is one composer. Only the bodies past
 * `PUBLISHING_PREVIEW_BODY_LIMIT` are elided — those pieces still travel the
 * composer, they just carry no text into it, which is what keeps a very long
 * manuscript from paying two DOM parses per chapter on every keystroke.
 */
export function buildPublishingPreview(
  project: Pick<Project, 'id' | 'title'>,
  profile: PublishingProfile,
  writings: readonly Writing[],
  citations: readonly Citation[],
  previewOptions: { titleOverride?: string; generatedAt?: number } = {},
): PublishingPreview {
  const resolved = resolvePublishingWritings(writings, profile);
  const listed = resolved.writings.slice(0, PUBLISHING_PREVIEW_OUTLINE_LIMIT);
  const artifacts = buildPublishingArtifacts(
    project,
    profile,
    listed.map((writing, index) => (
      index < PUBLISHING_PREVIEW_BODY_LIMIT ? writing : { ...writing, content: '' }
    )),
    citations,
    previewOptions,
  );
  const pieces = artifacts.document.sections.map((section, index) => ({
    id: section.id,
    title: section.title,
    synopsis: section.synopsis,
    // From the stored piece, not from the elided body it was compiled with.
    wordCount: publishingSectionWordCount(listed[index]),
    html: section.html,
    portableHtml: section.portableHtml,
    bodyCompiled: index < PUBLISHING_PREVIEW_BODY_LIMIT,
  }));
  const wordCount = resolved.writings.reduce(
    (total, writing) => total + publishingSectionWordCount(writing),
    0,
  );
  return {
    document: artifacts.document,
    pieces,
    unlistedPieceCount: resolved.writings.length - listed.length,
    pieceCount: resolved.writings.length,
    wordCount,
    pageEstimate: wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / PUBLISHING_WORDS_PER_PAGE)),
    content: probePublishingContent(resolved.writings),
    missingWritingIds: resolved.missingWritingIds,
    googleDocsWithoutContent: resolved.googleDocsWithoutContent.map(({ id, title }) => ({ id, title })),
  };
}

async function createConversion(
  projectId: string,
  source: { engineId: string; entityType: string; id: string; title: string },
  writing: Writing,
): Promise<ConversionReceipt> {
  const now = Date.now();
  const receipt: ConversionReceipt = {
    id: generateId('conversion'),
    projectId,
    sourceEngineId: source.engineId,
    sourceEntityId: source.id,
    targetEngineId: 'writings',
    targetEntityId: writing.id,
    targetTable: 'writings',
    preview: `${source.title} → ${writing.title}`,
    undoPayload: { targetId: writing.id, targetTable: 'writings' },
    receiptVersion: 2,
    targetVersion: writing.updatedAt,
    targetFingerprint: fingerprintConversionTarget(writing),
    createdAt: now,
  };
  const link: EntityLink = {
    id: generateId('link'),
    projectId,
    sourceEngineId: source.engineId,
    sourceEntityType: source.entityType,
    sourceEntityId: source.id,
    sourceTitle: source.title,
    targetEngineId: 'writings',
    targetEntityType: 'writing',
    targetEntityId: writing.id,
    targetTitle: writing.title,
    relation: 'promoted-to',
    provenance: 'conversion',
    createdAt: now,
    updatedAt: now,
  };
  receipt.conversionLinkId = link.id;
  await db.transaction('rw', [db.writings, db.conversionReceipts, db.entityLinks], async () => {
    await db.writings.add(writing);
    await db.conversionReceipts.add(receipt);
    await db.entityLinks.add(link);
  });
  return receipt;
}

export async function promoteNoteToWriting(noteId: string): Promise<ConversionReceipt> {
  const note = await db.notes.get(noteId);
  if (!note) throw new Error('Note not found');
  const firstLine = note.text.split('\n').find(line => line.trim())?.trim() ?? '';
  const title = [...firstLine].slice(0, 80).join('') || 'Promoted note';
  const writing: Writing = {
    id: generateId('wrt'),
    projectId: note.projectId,
    title,
    status: 'idea',
    content: `<p>${note.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '</p><p>')}</p>`,
    wordCount: note.text.trim().split(/\s+/).filter(Boolean).length,
    tags: [...note.tags],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return createConversion(note.projectId, { engineId: 'notes', entityType: 'note', id: note.id, title }, writing);
}

export async function promoteDiaryToWriting(entryId: string): Promise<ConversionReceipt> {
  const entry = await db.diaryEntries.get(entryId);
  if (!entry) throw new Error('Diary entry not found');
  const writing: Writing = {
    id: generateId('wrt'),
    projectId: entry.projectId,
    title: entry.title || `Diary — ${entry.entryDate}`,
    status: 'idea',
    content: entry.content,
    wordCount: stripHtml(entry.content).trim().split(/\s+/).filter(Boolean).length,
    tags: [...entry.tags],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return createConversion(entry.projectId, { engineId: 'diary', entityType: 'diary-entry', id: entry.id, title: writing.title }, writing);
}

export async function promoteSnapshotToWriting(snapshotId: string): Promise<ConversionReceipt> {
  const snapshot = await db.snapshots.get(snapshotId);
  if (!snapshot) throw new Error('Research snapshot not found');
  const sourceText = snapshot.extractedText || snapshot.notes || snapshot.description || snapshot.url;
  const writing: Writing = {
    id: generateId('wrt'),
    projectId: snapshot.projectId,
    title: snapshot.title || 'Research draft',
    status: 'idea',
    content: `<p>${sourceText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '</p><p>')}</p><p><a href="${snapshot.url}">${snapshot.url}</a></p>`,
    wordCount: sourceText.trim().split(/\s+/).filter(Boolean).length,
    tags: [...snapshot.tags],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return createConversion(snapshot.projectId, { engineId: 'scrapper', entityType: 'snapshot', id: snapshot.id, title: writing.title }, writing);
}

/**
 * Stable, local signature for the fields a conversion owns when it creates a
 * writing. `updatedAt` is also checked independently; the signature closes the
 * same-millisecond and direct-Dexie-write gaps without coupling this workflow
 * to the image-runtime recipe hasher.
 */
function fingerprintConversionTarget(writing: Writing): string {
  const semantic = JSON.stringify({
    id: writing.id,
    projectId: writing.projectId,
    title: writing.title,
    status: writing.status,
    content: writing.content,
    synopsis: writing.synopsis ?? null,
    wordCount: writing.wordCount,
    chapter: writing.chapter ?? null,
    tags: writing.tags,
    googleDocId: writing.googleDocId ?? null,
    googleDocUrl: writing.googleDocUrl ?? null,
    googleDocName: writing.googleDocName ?? null,
    lastSyncedAt: writing.lastSyncedAt ?? null,
    syncDirection: writing.syncDirection ?? null,
    isGoogleDoc: writing.isGoogleDoc ?? null,
    createdAt: writing.createdAt,
  });

  // Two differently-seeded FNV-1a lanes plus the byte length. This is an
  // integrity fingerprint, not an authentication primitive; the version token
  // and dependency checks below are separate guards.
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < semantic.length; index += 1) {
    const code = semantic.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `writing-v1:${semantic.length}:${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

export type ConversionUndoResult =
  | { status: 'not-found'; receiptId: string }
  | { status: 'already-undone'; receiptId: string; disposition?: ConversionReceipt['undoDisposition'] }
  | { status: 'removed-intact'; receiptId: string; targetEntityId: string }
  | {
      status: 'detached-preserved';
      receiptId: string;
      targetEntityId: string;
      reason: NonNullable<ConversionReceipt['undoReason']>;
    }
  | { status: 'target-missing'; receiptId: string; targetEntityId: string };

/**
 * Undo a promotion without ever interpreting an old receipt as permission to
 * destroy later work.
 *
 * A v2 target is physically removed only while its semantic fields and
 * monotonic version are byte-for-byte the ones the conversion created and no
 * user-owned history or relation points at it. Every other case keeps the
 * writing and merely removes the conversion provenance edge. The decision and
 * mutation share one transaction, so a concurrent edit can only make the
 * operation more conservative, never race underneath a delete.
 */
export async function undoConversion(receiptId: string): Promise<ConversionUndoResult> {
  const tables = [
    db.writings,
    db.writingSnapshots,
    db.entityLinks,
    db.conversionReceipts,
    db.outlineBeats,
    db.annotations,
    db.citations,
    db.publishingProfiles,
  ];

  return db.transaction('rw', tables, async (): Promise<ConversionUndoResult> => {
    const receipt = await db.conversionReceipts.get(receiptId);
    if (!receipt) return { status: 'not-found', receiptId };
    if (receipt.undoneAt) {
      return { status: 'already-undone', receiptId, disposition: receipt.undoDisposition };
    }
    if (receipt.targetTable !== 'writings') throw new Error('Unsupported conversion target');

    const target = await db.writings.get(receipt.targetEntityId);
    const projectLinks = await db.entityLinks.where('projectId').equals(receipt.projectId).toArray();
    const conversionLinks = projectLinks.filter(link =>
      link.provenance === 'conversion'
      && link.sourceEngineId === receipt.sourceEngineId
      && link.sourceEntityId === receipt.sourceEntityId
      && link.targetEngineId === receipt.targetEngineId
      && link.targetEntityId === receipt.targetEntityId
      && (!receipt.conversionLinkId || link.id === receipt.conversionLinkId),
    );

    const unlinkConversion = async (): Promise<void> => {
      if (conversionLinks.length) {
        await db.entityLinks.bulkDelete(conversionLinks.map(link => link.id));
      }
    };

    if (!target) {
      await unlinkConversion();
      await db.conversionReceipts.update(receipt.id, {
        undoneAt: Date.now(),
        undoDisposition: 'target-missing',
      });
      return { status: 'target-missing', receiptId, targetEntityId: receipt.targetEntityId };
    }

    const isModern = receipt.receiptVersion === 2
      && receipt.targetVersion !== undefined
      && Boolean(receipt.targetFingerprint);
    const scopeMatches = target.projectId === receipt.projectId;
    const targetChanged = !isModern
      || target.updatedAt !== receipt.targetVersion
      || fingerprintConversionTarget(target) !== receipt.targetFingerprint;

    const [snapshots, beats, annotations, citations, profiles] = await Promise.all([
      db.writingSnapshots.where('writingId').equals(target.id).count(),
      db.outlineBeats.where('projectId').equals(receipt.projectId).filter(beat => beat.linkedWritingId === target.id).count(),
      db.annotations.where('[sourceEngineId+sourceEntityId]').equals(['writings', target.id]).count(),
      db.citations.where('projectId').equals(receipt.projectId).filter(citation => citation.writingIds.includes(target.id)).count(),
      db.publishingProfiles.where('projectId').equals(receipt.projectId).filter(profile =>
        profile.selectedWritingIds.includes(target.id) || (profile.writingOrder ?? []).includes(target.id),
      ).count(),
    ]);
    const otherLinks = projectLinks.some(link =>
      !conversionLinks.some(conversion => conversion.id === link.id)
      && (
        (link.sourceEngineId === 'writings' && link.sourceEntityId === target.id)
        || (link.targetEngineId === 'writings' && link.targetEntityId === target.id)
      ),
    );
    const referenced = snapshots > 0 || beats > 0 || annotations > 0
      || citations > 0 || profiles > 0 || otherLinks;

    if (scopeMatches && !targetChanged && !referenced) {
      await unlinkConversion();
      await db.writings.delete(target.id);
      await db.conversionReceipts.update(receipt.id, {
        undoneAt: Date.now(),
        undoDisposition: 'removed-intact',
        undoReason: undefined,
      });
      return { status: 'removed-intact', receiptId, targetEntityId: target.id };
    }

    const reason: NonNullable<ConversionReceipt['undoReason']> = !scopeMatches
      ? 'scope-mismatch'
      : !isModern
        ? 'legacy'
        : referenced
          ? 'referenced'
          : 'changed';
    await unlinkConversion();
    await db.conversionReceipts.update(receipt.id, {
      undoneAt: Date.now(),
      undoDisposition: 'detached-preserved',
      undoReason: reason,
    });
    return {
      status: 'detached-preserved',
      receiptId,
      targetEntityId: target.id,
      reason,
    };
  });
}

export async function getGroundedAiPrivacy(projectId: string): Promise<GroundedAiPrivacy> {
  return {
    enabled: false,
    allowRemoteRequests: false,
    includeDrafts: true,
    includeResearch: true,
    maxContextCharacters: 24_000,
    ...parseJson<Partial<GroundedAiPrivacy>>(
      await projectOps.getSetting(`${AI_PRIVACY_PREFIX}${projectId}`),
      {},
    ),
  };
}

export async function saveGroundedAiPrivacy(
  projectId: string,
  privacy: GroundedAiPrivacy,
): Promise<void> {
  await projectOps.setSetting(`${AI_PRIVACY_PREFIX}${projectId}`, JSON.stringify(privacy));
}

export async function runGroundedProjectAnalysis(
  projectId: string,
  question: string,
  config: Parameters<typeof callAi>[2],
): Promise<GroundedAiResult> {
  const privacy = await getGroundedAiPrivacy(projectId);
  if (!privacy.enabled || !privacy.allowRemoteRequests) {
    throw new Error('Project-grounded AI is disabled by this project’s privacy controls.');
  }
  const hits = await searchProjectContent(question, projectId, 12);
  const allowed = hits.filter(hit =>
    (privacy.includeDrafts || hit.engineId !== 'writings') &&
    (privacy.includeResearch || hit.engineId !== 'scrapper'),
  );
  let used = 0;
  const context: string[] = [];
  const sources: GroundedAiResult['sources'] = [];
  for (const [index, hit] of allowed.entries()) {
    const sourceId = `S${index + 1}`;
    const block = `[${sourceId}] ${hit.engineId}: ${hit.title}\n${hit.snippet}`;
    if (used + block.length > privacy.maxContextCharacters) break;
    used += block.length;
    context.push(block);
    sources.push({ id: sourceId, engineId: hit.engineId, title: hit.title });
  }
  const answer = await callAi(
    'Answer only from the supplied project excerpts. Cite supporting excerpts with their [S#] identifiers. If the context is insufficient, say so explicitly. Never claim access to files that are not in the context.\n' + await buildProjectEditorialContext(projectId),
    `Question: ${question}\n\nProject excerpts:\n${context.join('\n\n')}`,
    config,
  );
  return { answer, sources };
}
