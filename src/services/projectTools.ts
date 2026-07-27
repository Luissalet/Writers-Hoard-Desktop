import { db } from '@/db';
import * as projectOps from '@/db/operations';
import { callAi } from '@/services/aiService';
import { searchProjectContent } from '@/services/projectSearchIndex';
import {
  buildManuscriptHtml,
  buildManuscriptMarkdown,
  canExportPdf,
  downloadTextFile,
  exportManuscriptPdf,
  sanitizeFilename,
} from '@/engines/writings/manuscriptExport';
import { generateId } from '@/utils/idGenerator';
import { stripHtml } from '@/utils/text';
import type { Project, ProjectMode, Writing } from '@/types';
import type {
  Citation,
  ConversionReceipt,
  EntityLink,
  PublishingFormat,
  PublishingProfile,
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
    enabledEngines: ['scrapper', 'notes', 'codex', 'timeline', 'biography', 'relationships', 'yarn-board', 'writings', 'annotations'],
    engineOrder: ['scrapper', 'notes', 'codex', 'timeline', 'biography', 'relationships', 'yarn-board', 'writings', 'annotations'],
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

export async function saveProjectAsRecipe(project: Project, name: string): Promise<ProjectRecipe> {
  const custom = parseJson<ProjectRecipe[]>(
    await projectOps.getSetting(TEMPLATE_SETTING),
    [],
  );
  const recipe: ProjectRecipe = {
    id: generateId('recipe'),
    name: name.trim() || `${project.title} template`,
    description: `Reusable engine setup from ${project.title}.`,
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
  const now = Date.now();
  const existing = value.id ? await db.citations.get(value.id) : undefined;
  const citation: Citation = {
    ...value,
    id: value.id ?? generateId('cite'),
    authors: value.authors.filter(Boolean),
    tags: value.tags.filter(Boolean),
    writingIds: [...new Set(value.writingIds)],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.citations.put(citation);
  return citation;
}

export async function citationFromSnapshot(snapshotId: string): Promise<Citation> {
  const snapshot = await db.snapshots.get(snapshotId);
  if (!snapshot) throw new Error('Research snapshot not found');
  return saveCitation({
    projectId: snapshot.projectId,
    title: snapshot.title || snapshot.url,
    authors: snapshot.author ? [snapshot.author] : [],
    publishedAt: snapshot.publishDate,
    accessedAt: new Date(snapshot.preservedAt || snapshot.createdAt).toISOString().slice(0, 10),
    url: snapshot.url,
    notes: snapshot.notes,
    snapshotId: snapshot.id,
    writingIds: [],
    tags: snapshot.tags,
  });
}

export async function deleteCitation(id: string): Promise<void> {
  await db.citations.delete(id);
}

export function formatCitation(citation: Citation, style: PublishingProfile['citationStyle']): string {
  const authors = citation.authors.length ? citation.authors.join(', ') : 'Unknown author';
  const year = citation.publishedAt?.slice(0, 4) || 'n.d.';
  const accessed = citation.accessedAt ? new Date(`${citation.accessedAt}T00:00:00`).toLocaleDateString() : '';
  if (style === 'mla') {
    return `${authors}. “${citation.title}.” ${citation.publisher ? `${citation.publisher}, ` : ''}${year}.${citation.url ? ` ${citation.url}.` : ''}${accessed ? ` Accessed ${accessed}.` : ''}`;
  }
  if (style === 'chicago') {
    return `${authors}. “${citation.title}.” ${citation.publisher ?? ''}${citation.publisher ? ', ' : ''}${year}.${citation.url ? ` ${citation.url}.` : ''}${accessed ? ` Accessed ${accessed}.` : ''}`;
  }
  return `${authors} (${year}). ${citation.title}.${citation.publisher ? ` ${citation.publisher}.` : ''}${citation.url ? ` ${citation.url}` : ''}`;
}

export async function exportBibliography(
  projectId: string,
  style: PublishingProfile['citationStyle'],
  projectTitle: string,
): Promise<void> {
  const citations = await getCitations(projectId);
  const text = citations
    .sort((a, b) => (a.authors[0] ?? '').localeCompare(b.authors[0] ?? ''))
    .map(citation => formatCitation(citation, style))
    .join('\n\n');
  downloadTextFile(
    `${projectTitle}\nBibliography (${style.toUpperCase()})\n\n${text}\n`,
    `${sanitizeFilename(projectTitle)}-bibliography-${style}.txt`,
    'text/plain',
  );
}

export async function getPublishingProfiles(projectId: string): Promise<PublishingProfile[]> {
  return db.publishingProfiles.where('projectId').equals(projectId).reverse().sortBy('updatedAt');
}

export async function savePublishingProfile(
  value: Omit<PublishingProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<PublishingProfile> {
  const now = Date.now();
  const existing = value.id ? await db.publishingProfiles.get(value.id) : undefined;
  const profile: PublishingProfile = {
    ...value,
    id: value.id ?? generateId('publish'),
    selectedWritingIds: [...new Set(value.selectedWritingIds)],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.publishingProfiles.put(profile);
  return profile;
}

export async function deletePublishingProfile(id: string): Promise<void> {
  await db.publishingProfiles.delete(id);
}

function chapterLabelFor(format: PublishingFormat): string {
  if (format === 'screenplay') return 'Scene';
  if (format === 'video') return 'Segment';
  if (format === 'research') return 'Section';
  if (format === 'biography') return 'Part';
  return 'Chapter';
}

export async function exportPublishingProfile(
  project: Project,
  profile: PublishingProfile,
  output: 'markdown' | 'html' | 'pdf',
): Promise<{ ok: boolean; error?: string }> {
  const allWritings = await db.writings.where('projectId').equals(project.id).toArray();
  const selected = profile.selectedWritingIds.length
    ? allWritings.filter(writing => profile.selectedWritingIds.includes(writing.id))
    : allWritings;
  const writings = selected.sort((a, b) => (a.chapter ?? Number.MAX_SAFE_INTEGER) - (b.chapter ?? Number.MAX_SAFE_INTEGER));
  const options = {
    projectTitle: `${project.title} — ${profile.name}`,
    includeTitlePage: profile.includeTitlePage,
    includeSynopsis: profile.includeSynopsis,
    chapterLabel: chapterLabelFor(profile.format),
  };
  let bibliography = '';
  if (profile.includeBibliography) {
    const citations = await getCitations(project.id);
    bibliography = citations.length
      ? `\n\n# Bibliography\n\n${citations.map(citation => formatCitation(citation, profile.citationStyle)).join('\n\n')}`
      : '';
  }

  if (output === 'markdown') {
    downloadTextFile(
      `${buildManuscriptMarkdown(writings, options)}${bibliography}`,
      `${sanitizeFilename(profile.name)}.md`,
      'text/markdown',
    );
    return { ok: true };
  }
  if (output === 'html') {
    const html = buildManuscriptHtml(writings, options).replace(
      '</body>',
      bibliography ? `<section class="chapter"><pre>${bibliography}</pre></section></body>` : '</body>',
    );
    downloadTextFile(html, `${sanitizeFilename(profile.name)}.html`, 'text/html');
    return { ok: true };
  }
  if (!canExportPdf()) return { ok: false, error: 'PDF export requires the desktop app.' };
  return exportManuscriptPdf(writings, options);
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
  const title = note.text.split('\n').find(line => line.trim())?.trim().slice(0, 80) || 'Promoted note';
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

export async function undoConversion(receiptId: string): Promise<void> {
  const receipt = await db.conversionReceipts.get(receiptId);
  if (!receipt || receipt.undoneAt) return;
  if (receipt.targetTable !== 'writings') throw new Error('Unsupported conversion target');
  await db.transaction('rw', [db.writings, db.writingSnapshots, db.entityLinks, db.conversionReceipts], async () => {
    await db.writingSnapshots.where('writingId').equals(receipt.targetEntityId).delete();
    await db.writings.delete(receipt.targetEntityId);
    await db.entityLinks.where('targetEntityId').equals(receipt.targetEntityId).delete();
    await db.conversionReceipts.update(receipt.id, { undoneAt: Date.now() });
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
    'Answer only from the supplied project excerpts. Cite supporting excerpts with their [S#] identifiers. If the context is insufficient, say so explicitly. Never claim access to files that are not in the context.',
    `Question: ${question}\n\nProject excerpts:\n${context.join('\n\n')}`,
    config,
  );
  return { answer, sources };
}
