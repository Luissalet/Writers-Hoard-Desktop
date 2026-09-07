import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import { extractReferenceSections, lexicalTerms, referenceKind, sha256Hex } from './text';
import type {
  ProjectReferenceLink,
  ReferenceCriterion,
  ReferenceDocument,
  ReferenceLens,
  ReferenceSection,
} from './types';

const MAX_REFERENCE_BYTES = 100 * 1024 * 1024;

export interface ReferenceLibraryEntry {
  document: ReferenceDocument;
  lenses: ReferenceLens[];
  linkedLensIds: Set<string>;
}

export interface ReferenceDeleteImpact {
  document: ReferenceDocument;
  projects: Array<{ id: string; title: string }>;
  runCount: number;
}

export interface AuthorizedLensEvidence {
  evidenceId: string;
  lensId: string;
  lensName: string;
  documentId: string;
  documentName: string;
  documentHash: string;
  documentVersion: number;
  sectionId: string;
  sectionHeading?: string;
  page?: number;
  quote: string;
  textHash: string;
}

function mimeFor(file: File): string {
  if (file.type) return file.type;
  const kind = referenceKind(file);
  return kind === 'pdf' ? 'application/pdf' : kind === 'markdown' ? 'text/markdown' : 'text/plain';
}

function linkFrom(
  projectId: string,
  document: ReferenceDocument,
  lens: ReferenceLens,
  previous?: ProjectReferenceLink,
): ProjectReferenceLink {
  const now = Date.now();
  return {
    id: previous?.id ?? `${projectId}:${lens.id}`,
    projectId,
    documentId: document.id,
    lensId: lens.id,
    active: previous?.active ?? true,
    status: document.status === 'ready' ? 'ready' : 'relink-required',
    documentName: document.name,
    documentHash: document.sha256,
    documentVersion: document.version,
    lensName: lens.name,
    sectionIds: [...lens.sectionIds],
    criteria: lens.criteria.map(criterion => ({ ...criterion })),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

async function ensureDefaultLens(
  document: ReferenceDocument,
  sections: readonly ReferenceSection[],
): Promise<ReferenceLens> {
  const current = await db.referenceLenses.where('documentId').equals(document.id).first();
  if (current) return current;
  const now = Date.now();
  const lens: ReferenceLens = {
    id: generateId('lens'),
    documentId: document.id,
    name: document.name.replace(/\.[^.]+$/, ''),
    sectionIds: sections.map(section => section.id),
    criteria: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.referenceLenses.add(lens);
  return lens;
}

export async function linkLensToProject(projectId: string, lensId: string): Promise<ProjectReferenceLink> {
  const lens = await db.referenceLenses.get(lensId);
  if (!lens) throw new Error('reference-lens-missing');
  const document = await db.referenceDocuments.get(lens.documentId);
  if (!document) throw new Error('reference-document-missing');
  const id = `${projectId}:${lens.id}`;
  const previous = await db.projectReferenceLinks.get(id);
  const link = linkFrom(projectId, document, lens, previous);
  await db.projectReferenceLinks.put(link);
  return link;
}

export async function createReferenceLens(
  projectId: string,
  documentId: string,
  name?: string,
): Promise<ReferenceLens> {
  const document = await db.referenceDocuments.get(documentId);
  if (!document) throw new Error('reference-document-missing');
  const sections = await db.referenceSections.where('documentId').equals(documentId).sortBy('order');
  if (!sections.length) throw new Error('reference-is-empty');
  const now = Date.now();
  const lens: ReferenceLens = {
    id: generateId('lens'),
    documentId,
    name: name?.trim() || `${document.name.replace(/\.[^.]+$/, '')} · ${now.toString(36).slice(-4)}`,
    sectionIds: sections.map(section => section.id),
    criteria: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', [db.referenceDocuments, db.referenceLenses, db.projectReferenceLinks], async () => {
    await db.referenceLenses.add(lens);
    await linkLensToProject(projectId, lens.id);
  });
  return lens;
}

export async function ingestReferenceFile(
  projectId: string,
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ document: ReferenceDocument; lens: ReferenceLens; duplicate: boolean }> {
  if (!referenceKind(file)) throw new Error('unsupported-reference-format');
  if (file.size > MAX_REFERENCE_BYTES) throw new Error('reference-too-large');
  const buffer = await file.arrayBuffer();
  if (options.signal?.aborted) throw new DOMException('Reference indexing cancelled', 'AbortError');
  const hash = await sha256Hex(buffer);
  const existing = await db.referenceDocuments.where('sha256').equals(hash).first();
  if (existing?.status === 'ready') {
    const sections = await db.referenceSections.where('documentId').equals(existing.id).sortBy('order');
    const lens = await ensureDefaultLens(existing, sections);
    await linkLensToProject(projectId, lens.id);
    return { document: existing, lens, duplicate: true };
  }

  const documentId = existing?.id ?? generateId('reference');
  let sections: ReferenceSection[];
  try {
    // Hashing and parsing share the same bytes: a 100 MB reference must not
    // become two simultaneous 100 MB ArrayBuffers merely for convenience.
    sections = await extractReferenceSections(documentId, file, { ...options, buffer });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const now = Date.now();
    const failed: ReferenceDocument = {
      id: documentId,
      name: file.name,
      mimeType: mimeFor(file),
      size: file.size,
      sha256: hash,
      version: existing?.version ?? 1,
      status: 'error',
      statusDetail: error instanceof Error ? error.message : String(error),
      original: file,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.referenceDocuments.put(failed);
    throw error;
  }

  const now = Date.now();
  const document: ReferenceDocument = {
    id: documentId,
    name: file.name,
    mimeType: mimeFor(file),
    size: file.size,
    sha256: hash,
    version: existing?.version ?? 1,
    status: 'ready',
    original: file,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  let lens!: ReferenceLens;
  await db.transaction(
    'rw',
    [db.referenceDocuments, db.referenceSections, db.referenceLenses, db.projectReferenceLinks],
    async () => {
      await db.referenceDocuments.put(document);
      await db.referenceSections.where('documentId').equals(documentId).delete();
      await db.referenceSections.bulkPut(sections);
      lens = await ensureDefaultLens(document, sections);
      await linkLensToProject(projectId, lens.id);
    },
  );
  return { document, lens, duplicate: false };
}

export async function listReferenceLibrary(projectId: string): Promise<ReferenceLibraryEntry[]> {
  const [documents, lenses, links] = await Promise.all([
    db.referenceDocuments.orderBy('updatedAt').reverse().toArray(),
    db.referenceLenses.toArray(),
    db.projectReferenceLinks.where('projectId').equals(projectId).toArray(),
  ]);
  const linkedLensIds = new Set(
    links.filter(link => link.active && link.status === 'ready').map(link => link.lensId),
  );
  return documents.map(document => ({
    document,
    lenses: lenses.filter(lens => lens.documentId === document.id),
    linkedLensIds,
  }));
}

export async function listProjectReferenceLinks(projectId: string): Promise<ProjectReferenceLink[]> {
  return db.projectReferenceLinks.where('projectId').equals(projectId).toArray();
}

/** The one evidence door exposed to agents: authorized fragments, never files. */
export async function retrieveAuthorizedLensEvidence(
  projectId: string,
  lensId: string,
  query: string,
  limit = 6,
): Promise<AuthorizedLensEvidence[]> {
  const link = await db.projectReferenceLinks.get(`${projectId}:${lensId}`);
  if (!link || !link.active || link.status !== 'ready') throw new Error('reference-lens-not-authorized');
  const [document, lens] = await Promise.all([
    db.referenceDocuments.get(link.documentId),
    db.referenceLenses.get(lensId),
  ]);
  if (!document || document.status !== 'ready' || !lens || lens.documentId !== document.id) {
    throw new Error('reference-document-missing');
  }
  if (document.sha256 !== link.documentHash || document.version !== link.documentVersion) {
    throw new Error('reference-document-versioned');
  }
  const allowed = new Set(lens.sectionIds);
  const wanted = new Set(lexicalTerms(query));
  const sections = (await db.referenceSections.where('documentId').equals(document.id).sortBy('order'))
    .filter(section => allowed.has(section.id));
  return sections
    .map((section, index) => ({
      section,
      index,
      score: section.terms.reduce((sum, term) => sum + (wanted.has(term) ? 1 : 0), 0)
        / Math.sqrt(Math.max(1, section.terms.length)),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(20, limit)))
    .map(({ section }) => ({
      evidenceId: `reference:${lens.id}:${section.id}`,
      lensId: lens.id,
      lensName: lens.name,
      documentId: document.id,
      documentName: document.name,
      documentHash: document.sha256,
      documentVersion: document.version,
      sectionId: section.id,
      sectionHeading: section.heading,
      page: section.page,
      quote: section.text,
      textHash: section.textHash,
    }));
}

export async function setProjectLensActive(
  projectId: string,
  lensId: string,
  active: boolean,
): Promise<void> {
  const id = `${projectId}:${lensId}`;
  const link = await db.projectReferenceLinks.get(id);
  if (!link) {
    if (active) await linkLensToProject(projectId, lensId);
    return;
  }
  await db.projectReferenceLinks.update(id, { active, updatedAt: Date.now() });
}

export async function unlinkLensFromProject(projectId: string, lensId: string): Promise<void> {
  await db.projectReferenceLinks.delete(`${projectId}:${lensId}`);
}

export async function updateReferenceLens(
  lensId: string,
  changes: { name?: string; sectionIds?: string[]; criteria?: ReferenceCriterion[] },
): Promise<ReferenceLens> {
  const lens = await db.referenceLenses.get(lensId);
  if (!lens) throw new Error('reference-lens-missing');
  const sectionIds = [...new Set(changes.sectionIds ?? lens.sectionIds)];
  const allowed = new Set(
    (await db.referenceSections.where('documentId').equals(lens.documentId).primaryKeys()) as string[],
  );
  if (!sectionIds.length) throw new Error('reference-lens-empty');
  if (sectionIds.some(id => !allowed.has(id))) throw new Error('reference-section-mismatch');
  const selectedSections = new Set(sectionIds);
  const criterionIds = new Set<string>();
  const criteria = (changes.criteria ?? lens.criteria).map(criterion => {
    const text = criterion.text.trim();
    if (
      !criterion.id
      || criterionIds.has(criterion.id)
      || !text
      || (criterion.sourceSectionId !== undefined && !selectedSections.has(criterion.sourceSectionId))
    ) {
      throw new Error('reference-criterion-invalid');
    }
    criterionIds.add(criterion.id);
    return { ...criterion, text };
  });
  const next: ReferenceLens = {
    ...lens,
    ...changes,
    sectionIds: [...sectionIds],
    criteria,
    updatedAt: Date.now(),
  };
  const document = await db.referenceDocuments.get(lens.documentId);
  await db.transaction('rw', [db.referenceLenses, db.projectReferenceLinks], async () => {
    await db.referenceLenses.put(next);
    if (!document) return;
    const links = await db.projectReferenceLinks.where('lensId').equals(lensId).toArray();
    if (links.length) {
      await db.projectReferenceLinks.bulkPut(links.map(link => linkFrom(link.projectId, document, next, link)));
    }
  });
  return next;
}

export async function inspectReferenceDelete(documentId: string): Promise<ReferenceDeleteImpact | null> {
  const document = await db.referenceDocuments.get(documentId);
  if (!document) return null;
  const links = await db.projectReferenceLinks.where('documentId').equals(documentId).toArray();
  const projectIds = [...new Set(links.map(link => link.projectId))];
  const projects = (await db.projects.bulkGet(projectIds)).flatMap(project =>
    project ? [{ id: project.id, title: project.title }] : [],
  );
  const runCount = (await Promise.all(projectIds.map(projectId =>
    db.judgeRuns.where('projectId').equals(projectId).filter(run =>
      run.sourceVersions.some(source => source.documentId === documentId),
    ).count(),
  ))).reduce((sum, count) => sum + count, 0);
  return { document, projects, runCount };
}

export async function deleteReferenceDocument(documentId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.referenceDocuments, db.referenceSections, db.referenceLenses, db.projectReferenceLinks],
    async () => {
      const links = await db.projectReferenceLinks.where('documentId').equals(documentId).toArray();
      if (links.length) {
        await db.projectReferenceLinks.bulkPut(links.map(link => ({
          ...link,
          active: false,
          status: 'missing' as const,
          updatedAt: Date.now(),
        })));
      }
      await db.referenceSections.where('documentId').equals(documentId).delete();
      await db.referenceLenses.where('documentId').equals(documentId).delete();
      await db.referenceDocuments.delete(documentId);
    },
  );
}

/** Relink an imported manifest without accepting a merely similar book. */
export async function relinkProjectReference(
  projectId: string,
  linkId: string,
  file: File,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const link = await db.projectReferenceLinks.get(linkId);
  if (!link || link.projectId !== projectId) throw new Error('reference-link-missing');
  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);
  if (hash !== link.documentHash) throw new Error('reference-relink-hash-mismatch');

  const existingByHash = await db.referenceDocuments.where('sha256').equals(hash).first();
  let document = existingByHash;
  let lens = existingByHash ? await db.referenceLenses.get(link.lensId) : undefined;
  if (lens && lens.documentId !== document?.id) throw new Error('reference-lens-id-collision');
  if (!document) {
    const occupied = await db.referenceDocuments.get(link.documentId);
    if (occupied && occupied.sha256 !== hash) throw new Error('reference-id-collision');
    const sections = await extractReferenceSections(link.documentId, file, { ...options, buffer: bytes });
    const now = Date.now();
    document = {
      id: link.documentId,
      name: link.documentName || file.name,
      mimeType: mimeFor(file),
      size: file.size,
      sha256: hash,
      version: link.documentVersion,
      status: 'ready',
      original: file,
      createdAt: now,
      updatedAt: now,
    };
    lens = {
      id: link.lensId,
      documentId: document.id,
      name: link.lensName,
      sectionIds: link.sectionIds.filter(id => sections.some(section => section.id === id)),
      criteria: link.criteria,
      createdAt: now,
      updatedAt: now,
    };
    if (!lens.sectionIds.length) lens.sectionIds = sections.map(section => section.id);
    await db.transaction(
      'rw',
      [db.referenceDocuments, db.referenceSections, db.referenceLenses],
      async () => {
        await db.referenceDocuments.add(document!);
        await db.referenceSections.bulkAdd(sections);
        await db.referenceLenses.put(lens!);
      },
    );
  }
  if (!lens) {
    const sections = await db.referenceSections.where('documentId').equals(document.id).sortBy('order');
    const occupied = await db.referenceLenses.get(link.lensId);
    if (occupied && occupied.documentId !== document.id) throw new Error('reference-lens-id-collision');
    const allowed = new Set(sections.map(section => section.id));
    const selected = link.sectionIds.filter(id => allowed.has(id));
    const now = Date.now();
    lens = {
      id: link.lensId,
      documentId: document.id,
      name: link.lensName,
      sectionIds: selected.length ? selected : sections.map(section => section.id),
      criteria: link.criteria.map(criterion => ({
        ...criterion,
        sourceSectionId: criterion.sourceSectionId && allowed.has(criterion.sourceSectionId)
          ? criterion.sourceSectionId
          : undefined,
      })),
      createdAt: now,
      updatedAt: now,
    };
    await db.referenceLenses.put(lens);
  }
  await db.projectReferenceLinks.put(linkFrom(projectId, document, lens, { ...link, active: true }));
}
