import JSZip from 'jszip';
import { Schema } from '@tiptap/pm/model';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { createFullZipArchive, createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import {
  createReferenceLens,
  deleteReferenceDocument,
  ingestReferenceFile,
  inspectJudgeEvidencePlan,
  findQuoteRangeInDocument,
  listProjectReferenceLinks,
  relinkProjectReference,
  retrieveAuthorizedLensEvidence,
  setProjectLensActive,
  updateReferenceLens,
} from '@/services/judge';
import type { Project, Writing } from '@/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT_A = 'critical-judge-a';
const PROJECT_B = 'critical-judge-b';

function project(id: string): Project {
  const now = Date.now();
  return {
    id,
    title: `Judge fixture ${id}`,
    mode: 'novelist',
    type: 'standalone',
    color: '#111111',
    description: '',
    status: 'in-progress',
    enabledEngines: ['writings'],
    engineOrder: ['writings'],
    createdAt: now,
    updatedAt: now,
  };
}

function writing(id: string, chapter: number, content: string): Writing {
  const now = Date.now() + chapter;
  return {
    id,
    projectId: PROJECT_B,
    title: `Chapter ${chapter}`,
    chapter,
    status: 'draft',
    content: `<p>${content}</p>`,
    wordCount: content.split(/\s+/).length,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function cleanup(documentId?: string): Promise<void> {
  for (const id of [PROJECT_A, PROJECT_B]) {
    if (await db.projects.get(id)) await deleteProject(id);
  }
  if (documentId && await db.referenceDocuments.get(documentId)) {
    await deleteReferenceDocument(documentId);
  }
}

export async function testJudgeContracts(): Promise<string[]> {
  await cleanup();
  await db.projects.bulkAdd([project(PROJECT_A), project(PROJECT_B)]);
  const previous = writing('critical-judge-previous', 1, 'Mara promised never to trust the council again.');
  const current = writing('critical-judge-current', 2, 'Mara gives the council the key without asking a question.');
  const future = writing('critical-judge-future', 3, 'Later the council reveals that the key was a trap.');
  await db.writings.bulkAdd([previous, current, future]);

  const source = new File([
    '# Causality\n\nA reversal must be prepared by a visible pressure or choice.\n\n' +
    '# Trust\n\nWhen trust changes, dramatize the evidence that made the new belief possible.',
  ], 'anatomy-of-test.md', { type: 'text/markdown' });
  let documentId: string | undefined;
  try {
    const first = await ingestReferenceFile(PROJECT_A, source);
    documentId = first.document.id;
    assert(!first.duplicate, 'first reference upload was reported as a duplicate');
    assert(first.document.original instanceof Blob, 'reference original was not kept as a managed Blob');
    assert(first.document.sha256.length === 64, 'reference source has no SHA-256');
    assert((await db.referenceSections.where('documentId').equals(documentId).count()) === 2, 'Markdown headings were not indexed as citeable sections');

    const second = await ingestReferenceFile(PROJECT_B, source);
    assert(second.duplicate, 'same private source was stored twice');
    assert(second.document.id === documentId, 'deduplicated source changed identity');
    const documents = await db.referenceDocuments.where('sha256').equals(first.document.sha256).toArray();
    assert(documents.length === 1, `same source produced ${documents.length} library rows`);

    const alternate = await createReferenceLens(PROJECT_B, documentId, 'Only trust');
    assert(alternate.documentId === documentId, 'second lens duplicated or detached its document');
    const links = await listProjectReferenceLinks(PROJECT_B);
    assert(links.length === 2, 'multiple contradictory lenses cannot coexist on one source');
    let emptyLensRefused = false;
    try {
      await updateReferenceLens(alternate.id, { sectionIds: [] });
    } catch (error) {
      emptyLensRefused = error instanceof Error && error.message === 'reference-lens-empty';
    }
    assert(emptyLensRefused, 'a lens without citeable sections was persisted');

    const evidence = await retrieveAuthorizedLensEvidence(PROJECT_B, second.lens.id, 'trust belief', 1);
    assert(evidence.length === 1 && evidence[0].sectionId, 'authorized retrieval did not return a citeable section');
    assert(evidence[0].quote.includes('trust'), 'lexical retrieval ignored the relevant section');
    await setProjectLensActive(PROJECT_B, second.lens.id, false);
    let refused = false;
    try {
      await retrieveAuthorizedLensEvidence(PROJECT_B, second.lens.id, 'trust', 1);
    } catch {
      refused = true;
    }
    assert(refused, 'an inactive lens still exposed private evidence');
    await setProjectLensActive(PROJECT_B, second.lens.id, true);

    const readerPlan = await inspectJudgeEvidencePlan({
      projectId: PROJECT_B,
      writing: current,
      currentContent: current.content,
      mode: 'reader',
      scope: 'chapter',
      sourceMode: 'continuity',
      lensIds: [],
      context: {
        previousWritings: true,
        selectedWritingIds: [future.id],
        codex: true,
        outline: true,
        timeline: true,
      },
      outputLanguage: 'English',
    });
    assert(readerPlan.internal.some(row => row.entityId === previous.id), 'Reader did not receive the earlier chapter');
    assert(!readerPlan.internal.some(row => row.entityId === future.id), 'Reader retrieved a future chapter');
    assert(readerPlan.internal.every(row => row.engineId === 'writings'), 'Reader bypassed the chronological guard through another engine');

    const foreign = { ...writing('critical-judge-foreign', 9, 'Private material from another project.'), projectId: PROJECT_A };
    await db.writings.add(foreign);
    const scopedTargets = await inspectJudgeEvidencePlan({
      projectId: PROJECT_B,
      writing: current,
      currentContent: current.content,
      mode: 'judge',
      scope: 'writings',
      sourceMode: 'continuity',
      lensIds: [],
      context: {
        previousWritings: false,
        selectedWritingIds: [foreign.id],
        codex: false,
        outline: false,
        timeline: false,
      },
      outputLanguage: 'English',
    });
    assert(!scopedTargets.targetWritingIds.includes(foreign.id), 'Judge target scope crossed into another project');

    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'text*', group: 'block' },
        text: { group: 'inline' },
      },
    });
    const repeatedDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('same choice')),
      schema.node('paragraph', null, schema.text('between')),
      schema.node('paragraph', null, schema.text('same choice')),
    ]);
    const firstRange = findQuoteRangeInDocument(repeatedDoc, 'same choice');
    const preferredRange = findQuoteRangeInDocument(repeatedDoc, 'same choice', 100);
    assert(firstRange && preferredRange && preferredRange.from > firstRange.from, 'Judge ignored the stored anchor when a quote repeated');

    const fullArchive = await createFullZipArchive();
    const fullZip = await JSZip.loadAsync(fullArchive.blob);
    const fullManifest = JSON.parse(await fullZip.file('manifest.json')!.async('string')) as {
      version?: number;
      referenceLibrary?: { included?: boolean; originals?: boolean };
    };
    assert(fullManifest.version === 4, 'canonical full backup did not use the current format');
    assert(
      fullManifest.referenceLibrary?.included === true
      && fullManifest.referenceLibrary.originals === true,
      'canonical full backup did not declare the private reference library',
    );
    const library = JSON.parse(await fullZip.file('reference-library.json')!.async('string')) as {
      documents: Array<{ id: string; sha256: string; originalPath: string }>;
    };
    const archivedDocument = library.documents.find(row => row.id === documentId);
    assert(archivedDocument?.sha256 === first.document.sha256, 'full backup lost reference metadata');
    const original = archivedDocument ? fullZip.file(archivedDocument.originalPath) : null;
    assert(original && await original.async('string') === await source.text(), 'full backup lost the managed reference original');

    await deleteProject(PROJECT_A);
    assert(await db.referenceDocuments.get(documentId), 'deleting one project deleted its shared private source');

    const archive = await createProjectZipArchive(PROJECT_B);
    const zip = await JSZip.loadAsync(archive.blob);
    assert(!Object.keys(zip.files).some(path => path.startsWith('reference-library/originals/')), 'project backup leaked a private reference original');
    assert(Object.keys(zip.files).some(path => path.endsWith('/writings/_judge_links.json')), 'project backup omitted its reference manifests');

    await deleteProject(PROJECT_B);
    await deleteReferenceDocument(documentId);
    await importProjectZip(new File([archive.blob], archive.fileName, { type: 'application/zip' }));
    const pending = await listProjectReferenceLinks(PROJECT_B);
    assert(pending.length === 2 && pending.every(link => link.status === 'relink-required' && !link.active), 'restore pretended a missing private original was available');

    let mismatchRefused = false;
    try {
      await relinkProjectReference(PROJECT_B, pending[0].id, new File(['different'], source.name, { type: source.type }));
    } catch {
      mismatchRefused = true;
    }
    assert(mismatchRefused, 'relink accepted a source whose SHA-256 did not match');
    await relinkProjectReference(PROJECT_B, pending[0].id, source);
    const relinked = await db.projectReferenceLinks.get(pending[0].id);
    assert(relinked?.status === 'ready' && relinked.active, 'exact-source relink did not restore the project lens');

    return [
      'Judge: private references deduplicate across projects and lenses',
      'Judge: Reader excludes future knowledge before retrieval',
      'Judge: project backups carry manifests, never private originals, and require hash-verified relink',
      'Judge: the canonical full backup preserves and declares the private reference library',
    ];
  } finally {
    await cleanup(documentId);
  }
}
