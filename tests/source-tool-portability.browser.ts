import '@/engines';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData, exportFullDatabase, importFullDatabase } from '@/db/operations';
import { createProjectZipArchive, importProjectZip, createFullZipArchive, importFullZip } from '@/services/zipBackup';
import JSZip from 'jszip';
import { saveWorldEra, readWorldDocument, saveEraDocument } from '@/services/worldEras/store';
import { preserveLegacyProjectMetadata, validateProjectArchiveMetadata } from '@/services/projectArchiveMetadata';
import { updateWorkspaceLibrary } from '@/components/project/workspace/library/store';
import type { SourceToolDocument } from '@/engines/local/documents/types';
import type { LocalToolJson } from '@/engines/local/stateTypes';
import type { Project } from '@/types';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw Error(message); };
const equal = (a: unknown, b: unknown, message: string) => assert(JSON.stringify(a) === JSON.stringify(b), message);
export async function testSourceToolPortability(): Promise<string[]> {
  const P = 'source-tool-portability', clones: string[] = [], passed: string[] = [];
  const opaque = { id: 'source-doc', projectId: P, sourceId: 'source-doc', content: `<div data-wh-codex-block="true" data-project-id="${P}" data-entry-id="harbour"></div>`, nested: ['harbour', P] };
  const source: SourceToolDocument = { id: 'source-doc', namespace: 'missing.uncompiled-source', title: 'Source notebook', revision: 3, createdAt: 1, updatedAt: 3, data: { opaque, prose: 'harbour source-doc', ref: { kind: 'codex', documentId: 'harbour' }, self: { kind: 'local-tool', documentId: 'source-doc' }, items: [{ id: 'stable-item', text: 'source-doc', link: { kind: 'codex', documentId: 'harbour' } }] }, codec: { version: 1, fields: { prose: { kind: 'prose' }, ref: { kind: 'reference' }, self: { kind: 'reference' }, items: { kind: 'list', idKey: 'id', referenceKey: 'link' } } } };
  const project: Project = { id: P, title: 'Source documents', description: '', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1, sourceToolDocuments: [source] };
  try {
    validateProjectArchiveMetadata(project);
    equal(preserveLegacyProjectMetadata({}, project).sourceToolDocuments, [source], 'Legacy absence erased documents');
    equal(preserveLegacyProjectMetadata({ sourceToolDocuments: [] }, project).sourceToolDocuments, [], 'Explicit empty collection was ignored');
    let rejected = false;
    try { validateProjectArchiveMetadata({ sourceToolDocuments: [source, source] }); } catch { rejected = true; }
    assert(rejected, 'Duplicate source IDs accepted');
    await db.projects.put(project);
    await db.codexEntries.put({ id: 'harbour', projectId: P, title: 'Harbour', content: '', tags: [], fields: {}, relations: [], createdAt: 1, updatedAt: 1 } as never);
    await db.projects.update(P, { sourceToolDocuments: [{ ...source, revision: 4, title: 'Base edited', updatedAt: 4 }] });
    await saveWorldEra(P, { id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const scope = { projectId: P, eraId: 'past' };
    const inherited = (await readWorldDocument(scope, 'local-tool', source.id))!;
    const first = await saveEraDocument(scope, 'local-tool', { root: { ...inherited.document.root, revision: 5, title: 'Past one', updatedAt: 5 }, children: {} }, inherited.version);
    await saveEraDocument(scope, 'local-tool', { root: { ...first.document.root, revision: 6, title: 'Past two', updatedAt: 6 }, children: {} }, first.version);
    await updateWorkspaceLibrary(P, 0, { kind: 'place', documents: [{ engineId: 'local-tool-missing.uncompiled-source', entityId: source.id }] });
    passed.push('Pure source metadata validates without compiled source; legacy absence preserves documents and explicit [] clears');

    const exported = await exportProjectData(P), cloneId = await importProjectData(exported);
    clones.push(cloneId);
    const copied = (await db.projects.get(cloneId))!, document = copied.sourceToolDocuments![0], card = (await db.codexEntries.where('projectId').equals(cloneId).first())!;
    const check = (row: SourceToolDocument) => {
      assert(row.id === document.id && row.id !== source.id && row.revision === 0, 'Source identity/revision not cloned');
      const data = row.data as Record<string, LocalToolJson>;
      equal(data.opaque, opaque, 'Opaque nested IDs/prose/HTML mutated');
      assert(data.prose === 'harbour source-doc', 'Prose mutated');
      equal(data.ref, { kind: 'codex', documentId: card.id }, 'Declared codex reference not remapped');
      equal(data.self, { kind: 'local-tool', documentId: document.id }, 'Declared self reference not remapped');
      equal(data.items, [{ id: 'stable-item', text: 'source-doc', link: { kind: 'codex', documentId: card.id } }], 'Stable local IDs or declared list refs changed incorrectly');
    };
    check(document);
    const variants = await db.worldEraVariants.where('projectId').equals(cloneId).toArray();
    const variant = variants.find(row => row.kind === 'local-tool')!;
    assert(variant && variant.entityId === document.id && variant.eraId === copied.worldEras![0].id, 'Era scope identity not remapped');
    for (const state of [variant, ...(variant.history ?? [])]) if (state.document) check(state.document.root as unknown as SourceToolDocument);
    const history = (await db.documentHistory.where('projectId').equals(cloneId).toArray()).filter(row => row.kind === 'local-tool');
    assert(history.length > 0, 'Base source history lost');
    for (const row of history) check(row.document.root as unknown as SourceToolDocument);
    assert(copied.workspacePlacements?.some(row => row.engineId === 'local-tool-missing.uncompiled-source' && row.entityId === document.id), 'Source Library placement lost');
    passed.push('Real JSON clone remaps Base/era/retained history and Library identity; opaque tool JSON stays byte-identical, only declared references change');

    const full = await exportFullDatabase(), zip = await createProjectZipArchive(P);
    await deleteProject(P);
    await importFullDatabase(full);
    equal((await db.projects.get(P))!.sourceToolDocuments, (exported.project as Project).sourceToolDocuments, 'Full JSON changed source documents');
    await deleteProject(P);
    await importProjectZip(new File([zip.blob], 'source-tools.zip', { type: 'application/zip' }));
    equal((await db.projects.get(P))!.sourceToolDocuments, (exported.project as Project).sourceToolDocuments, 'ZIP changed source documents');
    assert((await db.worldEraVariants.where('projectId').equals(P).toArray()).some(row => row.kind === 'local-tool' && row.history?.length), 'ZIP lost retained era states');
    passed.push('Normal full JSON and project ZIP restore source documents and era history with source code absent');

    const all = await createFullZipArchive();
    const rewrite = async (blob: Blob, mode: 'legacy' | 'clear') => {
      const archive = await JSZip.loadAsync(await blob.arrayBuffer());
      for (const name of Object.keys(archive.files).filter(name => name.endsWith('/project.json'))) {
        const row = JSON.parse(await archive.file(name)!.async('string'));
        if (mode === 'legacy') delete row.sourceToolDocuments; else row.sourceToolDocuments = [];
        archive.file(name, JSON.stringify(row));
      }
      return new File([await archive.generateAsync({ type: 'blob' })], 'source-tools.zip');
    };
    await importFullZip(await rewrite(all.blob, 'legacy'));
    equal((await db.projects.get(P))!.sourceToolDocuments, (exported.project as Project).sourceToolDocuments, 'Legacy full ZIP erased source documents');
    await importFullZip(await rewrite(all.blob, 'clear'));
    equal((await db.projects.get(P))!.sourceToolDocuments, [], 'Full ZIP ignored explicit []');
    await importFullDatabase(full);
    const bad = structuredClone(exported);
    bad.project!.sourceToolDocuments = [source, source];
    const projectIds = (await db.projects.toArray()).map(row => row.id).sort();
    rejected = false;
    try { await importProjectData(bad); } catch { rejected = true; }
    assert(rejected, 'Malformed source collection imported');
    equal((await db.projects.toArray()).map(row => row.id).sort(), projectIds, 'Rejected source import wrote a project');
    passed.push('Actual full ZIP distinguishes legacy absence from explicit []; malformed source import fails before writes');
    return passed;
  } finally {
    for (const clone of clones) await deleteProject(clone);
    await deleteProject(P);
  }
}
