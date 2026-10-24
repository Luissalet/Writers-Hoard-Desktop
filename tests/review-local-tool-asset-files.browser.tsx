import { db } from '@/db';
import type { Project } from '@/types';
import { deleteProject, exportProjectData, importProjectData, exportFullDatabase, importFullDatabase } from '@/db/operations';
import { defineLocalTool, type LocalToolJson } from '@/engines/local/sdk';
import { createLocalToolClient } from '@/engines/local/storage';
import { registerLocalToolModules } from '@/engines/local/registry';
import { LOCAL_TOOL_SOURCE_FORMAT, localToolReleaseIdentity } from '@/engines/local/releaseFormat.mjs';
import { createSourceToolDocument } from '@/engines/local/documents/store';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { LOCAL_ASSET_HANDLERS } from '@/engines/local/assetBridge';
import { prepareAssetFile } from '@/engines/local/assetFileFormat';
import { createLocalAudioEngine, type LocalAudioRef } from '@/engines/local/audio';
import { createRecordingLocalToolAudio } from '@/engines/local/audioTesting';
import JSZip from 'jszip';

const NS = 'review.asset-files';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mWQAAAAASUVORK5CYII=';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const digest = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('');
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
async function fixture(projectId: string) {
  const initialState = { assetOverrides: {} as Record<string, { kind: string; id: string }> };
  const validateState = (value: LocalToolJson): value is typeof initialState => !!value && typeof value === 'object' && !Array.isArray(value) && !!value.assetOverrides && typeof value.assetOverrides === 'object' && !Array.isArray(value.assetOverrides);
  const bytes = { 'assets/data.bin': new Blob(['DEFAULT DATA'], { type: 'application/octet-stream' }), 'assets/tone.wav': new Blob(['DEFAULT TONE'], { type: 'audio/wav' }), 'assets/icon.png': new Blob([Uint8Array.of(0)], { type: 'image/png' }) };
  const source = defineLocalTool({ namespace: NS, name: { en: 'Independent file inventory', es: 'Archivos independientes' }, description: { en: 'Storage/API probe', es: 'Sonda API' }, initialState, validateState,
    codec: { version: 1, fields: { assetOverrides: { kind: 'map', assetReferenceValues: true } } }, component: () => null,
    document: { defaultTitle: { en: 'File test', es: 'Archivo QA' } },
    assets: { data: { kind: 'data', path: 'assets/data.bin', aliases: ['payload'] }, locked: { kind: 'data', path: 'assets/data.bin', replaceable: false }, tone: { kind: 'audio', path: 'assets/tone.wav' }, icon: { kind: 'image', path: 'assets/icon.png' } },
    assetFiles: Object.fromEntries(Object.entries(bytes).map(([key, blob]) => [key, async () => blob])) });
  const files = await Promise.all(Object.entries(bytes).map(async ([path, blob]) => ({ path, bytes: blob.size, sha256: await digest(blob) })));
  files.push({ path: 'module.tsx', bytes: 0, sha256: await digest(new Blob([])) });
  const manifest = { format: LOCAL_TOOL_SOURCE_FORMAT, apiVersion: 1 as const, namespace: NS, version: '1.0.0', files, contentHash: '' };
  manifest.contentHash = await digest(new Blob([localToolReleaseIdentity(manifest)]));
  registerLocalToolModules({ [`./installed/${NS}/versions/${manifest.contentHash}/module.tsx`]: { default: source } }, { [`./installed/${NS}/versions/${manifest.contentHash}/release.json`]: manifest });
  const project = { id: projectId, title: projectId, description: '', mode: 'custom', type: 'standalone', color: '#446688', status: 'draft', enabledEngines: [`local-tool-${NS}`], createdAt: 1, updatedAt: 1,
    worldEras: [{ id: 'past', name: 'Past', description: '', revision: 0, createdAt: 1, updatedAt: 1 }], localToolInstallations: { [NS]: { contentHash: manifest.contentHash, revision: 1, updatedAt: 1 } } } as Project;
  await db.projects.put(project);
  return { project, source, client: createLocalToolClient(projectId, source, { requireSelectedRelease: true, releaseHash: manifest.contentHash }) };
}
async function inventory(projectId: string) {
  const files = await db.localToolAssetFiles.where('projectId').equals(projectId).toArray();
  return JSON.stringify(stable({ project: await db.projects.get(projectId), files: await Promise.all(files.sort((a, b) => a.id.localeCompare(b.id)).map(async row => ({ ...row, blob: { bytes: row.blob.size, type: row.blob.type, actualHash: await digest(row.blob) } }))) }));
}
const args = (projectId: string, more: Record<string, unknown> = {}) => ({ projectId, namespace: NS, slot: 'data', level: 'installation', ...more });
async function tool(name: string, input: Record<string, unknown>) {
  const result = await runBridgeTool(name, input); assert(result.ok, `${name}: ${JSON.stringify(result)}`); return result.result as Record<string, any>;
}

export async function reviewAssetFilesInventoryAndDomainIsolation(): Promise<string[]> {
  const id = 'review-files-inventory', foreignId = `${id}-foreign`;
  try {
    const { project, source, client } = await fixture(id);
    await db.projects.put({ ...project, id: foreignId }); const other = createLocalToolClient(foreignId, source);
    const one = await client.assets.import(new File(['IDENTICAL BYTES'], 'first.dat', { type: 'text/plain' }), 'data');
    const two = await client.assets.import(new File(['IDENTICAL BYTES'], 'different-name.dat', { type: 'text/plain' }), 'data');
    assert(one.id === two.id && two.title === 'first.dat' && one.sha256 === two.sha256, 'Dedupe overwrote immutable file identity/title');
    const distinct = await client.assets.import(new File(['IDENTICAL BYTES'], 'other-mime.dat', { type: 'application/octet-stream' }), 'data');
    assert(distinct.id !== one.id, 'Dedupe merged distinct MIME identities');
    assert(await other.assets.resolve(one.ref) === null && !(await other.assets.choices('data')).length, 'Foreign file was resolvable/listed');
    const readonly = createLocalToolClient(id, source, { readOnly: true, assetDefaultsWritable: () => true }), before = await inventory(id);
    let rejected = false; try { await readonly.assets.import(new File(['READONLY MUST NOT WRITE'], 'readonly.dat'), 'data'); } catch { rejected = true; }
    assert(rejected && await inventory(id) === before, 'Installation exception escaped strict readonly import guard');
    await client.assets.installation.set('data', one.ref, (await client.assets.installation.read()).version);
    const plain = await tool('wh_local_asset_resolve', args(id)), content = await tool('wh_local_asset_resolve', args(id, { includeContent: true }));
    assert(!Object.hasOwn(plain, 'content') && content.content.base64 === btoa('IDENTICAL BYTES') && content.content.sha256 === one.sha256, 'Opt-in metadata/content response changed exact bytes');
    const slots = await tool('wh_local_asset_slots', { projectId: id, namespace: NS });
    assert(!Object.hasOwn(slots, 'choices'), 'Legacy slot response acquired file choices without opt-in');
    assert(!(await client.assets.choices('audio')).some(row => row.ref.kind === 'file') && !(await client.assets.choices('image')).some(row => row.ref.kind === 'file'), 'File inventory leaked into media/image choice domains');
    const audio = createRecordingLocalToolAudio(); let resolved = false;
    const owner = createLocalAudioEngine(audio.backend).createOwner({ resolve: async () => { resolved = true; return null; } });
    let refused = false; try { await owner.play(one.ref as unknown as LocalAudioRef); } catch { refused = true; } finally { owner.dispose(); }
    assert(refused && !resolved && !audio.commands.length, 'File ref reached audio resolver/backend');
    return ['Independent immutable-file API oracle: dedupe identity/MIME, readonly exception denial, foreign scope, opt-in bytes and explicit file/media/image/audio domains'];
  } finally { await deleteProject(id); await deleteProject(foreignId); }
}

export async function reviewAssetFilesCompositeCasAndImportOnly(): Promise<string[]> {
  const id = 'review-files-composite';
  try {
    const { client, source } = await fixture(id), document = await createSourceToolDocument({ projectId: id }, NS, 'Independent composite'), scoped = createLocalToolClient(id, source, { documentId: document.id });
    const observed = (await client.assets.installation.read()).version;
    const file = { name: 'selected.json', kind: 'data', mime: 'application/json', base64: btoa('{"independent":"selected"}') };
    await tool('wh_local_asset_override', args(id, { expectedVersion: observed, file }));
    const before = await inventory(id);
    for (const input of [
      args(id, { expectedVersion: observed, file: { ...file, base64: btoa('NEW STALE BYTES') } }),
      args(id, { expectedVersion: (await client.assets.installation.read()).version, file, ref: null }),
      args(id, { expectedVersion: (await client.assets.installation.read()).version, importOnly: true }),
      args(id, { slot: 'locked', expectedVersion: (await client.assets.installation.read()).version, file: { ...file, base64: btoa('LOCKED BYTES') } }),
      args(id, { slot: 'tone', expectedVersion: (await client.assets.installation.read()).version, file: { ...file, base64: btoa('WRONG SLOT KIND') } }),
    ]) {
      const result = await runBridgeTool('wh_local_asset_override', input);
      assert(!result.ok && await inventory(id) === before, 'Rejected composite call left file or changed selected state');
    }
    const baseline = await scoped.read(), imported = await tool('wh_local_asset_override', args(id, { documentId: document.id, level: 'document', expectedVersion: baseline.document!.version, importOnly: true, file: { ...file, base64: btoa('IMPORTED ONLY') } }));
    assert(imported.applied === false && imported.imported?.ref.kind === 'file' && !imported.receiptId && JSON.stringify((await scoped.read()).data) === JSON.stringify(baseline.data), 'ImportOnly selected an override or manufactured Undo receipt');
    const beforeWrongScope = await inventory(id), foreign = await createSourceToolDocument({ projectId: id }, NS, 'Other document');
    const applied = await tool('wh_local_asset_override', args(id, { documentId: document.id, level: 'document', expectedVersion: baseline.document!.version, ref: imported.imported.ref }));
    const wrong = await runBridgeTool('wh_local_tool_state_undo', { projectId: id, namespace: NS, documentId: foreign.id, receiptId: applied.receiptId });
    assert(!wrong.ok && JSON.stringify((await scoped.read()).data).includes(imported.imported.id), 'Receipt crossed native document scope');
    await tool('wh_local_tool_state_undo', { projectId: id, namespace: NS, documentId: document.id, receiptId: applied.receiptId });
    assert((await db.localToolAssetFiles.get(imported.imported.id))?.sha256 === imported.imported.sha256 && beforeWrongScope.length > 0, 'Undo deleted immutable inventory');
    return ['Independent registered composite oracle: stale/invalid/locked/incompatible calls are atomic; importOnly is unselected/unreceipted and linked document Undo stays scoped'];
  } finally { await deleteProject(id); }
}

export async function reviewAssetFilesOuterCommitAndAbort(): Promise<string[]> {
  const id = 'review-files-outer-commit';
  try {
    const { client, source } = await fixture(id), document = await createSourceToolDocument({ projectId: id }, NS, 'Outer transaction'), scoped = createLocalToolClient(id, source, { documentId: document.id });
    const baseline = await scoped.read(), before = await inventory(id), file = { name: 'outer.bin', kind: 'data' as const, mime: 'application/octet-stream', base64: btoa('OUTER PREPARATION BYTES') };
    let earlyReceipt = '', earlyUnavailable = false;
    try {
      await db.transaction('rw', db.tables, async () => {
        const result = await LOCAL_ASSET_HANDLERS.wh_local_asset_override(args(id, { documentId: document.id, level: 'document', expectedVersion: baseline.document!.version, file })) as { receiptId: string };
        earlyReceipt = result.receiptId; assert(earlyReceipt, 'Document composite did not expose its deferred receipt identity');
        await scoped.state!.undo(earlyReceipt);
        throw Error('Receipt incorrectly usable before outer commit');
      });
    } catch (error) { earlyUnavailable = String(error).includes('local_tool_state_receipt_unavailable'); }
    assert(earlyUnavailable && await inventory(id) === before, 'Precommit receipt became usable or aborted file/selection escaped outer transaction');
    const unavailable = await runBridgeTool('wh_local_tool_state_undo', { projectId: id, namespace: NS, documentId: document.id, receiptId: earlyReceipt });
    assert(!unavailable.ok, 'Aborted receipt became consumable after rollback');
    const marker = new Error('abort after SDK direct import'); let didAbort = false;
    try { await db.transaction('rw', db.tables, async () => { await client.assets.import(new File(['SDK OUTER ROLLBACK'], 'sdk-outer.dat'), 'data'); throw marker; }); } catch (error) { assert(error === marker, `SDK import failed composition before deliberate abort: ${String(error)}`); didAbort = true; }
    assert(didAbort && await inventory(id) === before, 'Direct SDK preparation/import escaped outer transaction');
    const applied = await tool('wh_local_asset_override', args(id, { documentId: document.id, level: 'document', expectedVersion: baseline.document!.version, file }));
    assert(applied.receiptId && applied.imported?.id, 'Committed document import lacks normal receipt/file');
    const undo = await tool('wh_local_tool_state_undo', { projectId: id, namespace: NS, documentId: document.id, receiptId: applied.receiptId });
    await tool('wh_local_tool_state_redo', { projectId: id, namespace: NS, documentId: document.id, receiptId: undo.receiptId });
    assert(JSON.stringify((await scoped.read()).data).includes(applied.imported.id) && await db.localToolAssetFiles.get(applied.imported.id), 'Postcommit Undo/Redo lost file identity or inventory');
    return ['Independent native outer-transaction oracle: receipts unavailable before commit/after abort, prepared SDK bytes roll back, committed Undo/Redo retains immutable files'];
  } finally { await deleteProject(id); }
}

async function seedCollision(id: string) {
  const result = await fixture(id), shared = `${id}-same-id`, file = { ...await prepareAssetFile(new File(['FILE DOMAIN BYTES'], 'file.dat', { type: 'application/octet-stream' }), 'data', id), id: shared };
  await db.localToolAssetFiles.put(file);
  await db.inspirationImages.put({ id: shared, projectId: id, name: 'IMAGE DOMAIN', imageData: PNG, notes: '', tags: [], createdAt: 1 });
  await db.localMediaAssets.put({ id: shared, projectId: id, title: 'MEDIA DOMAIN', kind: 'audio', mime: 'audio/wav', blob: new Blob(['MEDIA DOMAIN BYTES'], { type: 'audio/wav' }), size: 18, notes: '', tags: [], linkedEntryIds: [], createdAt: 1, updatedAt: 1 });
  for (const [slot, kind] of [['data', 'file'], ['icon', 'image'], ['tone', 'media']] as const) await result.client.assets.installation.set(slot, { kind, id: shared }, (await result.client.assets.installation.read()).version);
  return { ...result, file, shared };
}
async function verifyDomains(projectId: string, source: Awaited<ReturnType<typeof fixture>>['source']) {
  const client = createLocalToolClient(projectId, source), refs = await Promise.all(['data', 'icon', 'tone'].map(slot => client.assets.slot(slot)));
  assert(refs.every(Boolean) && refs.map(value => value!.ref.kind).join() === 'file,image,media', 'Portable asset reference kinds collapsed');
  const ids = refs.map(value => (value!.ref as { id: string }).id);
  assert(new Set(ids).size === 3 && await refs[0]!.blob.text() === 'FILE DOMAIN BYTES' && await refs[2]!.blob.text() === 'MEDIA DOMAIN BYTES', 'Literal ID collision merged domains or changed bytes');
  return refs;
}

export async function reviewAssetFilesCloneAndDuplicateDomains(): Promise<string[]> {
  await import('@/engines');
  const { previewProjectDuplicate, duplicateProject } = await import('@/services/projectDuplicate/service');
  const id = 'review-files-clone-domains', copies: string[] = [];
  try {
    const { source, file } = await seedCollision(id), before = await inventory(id), exported = await exportProjectData(id), cloned = await importProjectData(exported); copies.push(cloned);
    await verifyDomains(cloned, source);
    const cloneFile = (await db.localToolAssetFiles.where('projectId').equals(cloned).toArray())[0];
    assert(cloneFile.id !== file.id && cloneFile.sha256 === file.sha256 && await digest(cloneFile.blob) === file.sha256, 'JSON clone lost file digest or source identity isolation');
    const preview = await previewProjectDuplicate({ projectId: id }), duplicated = await duplicateProject({ projectId: id, operationId: 'review_asset_file_domains', expectedSourceVersion: preview.sourceVersion, title: 'Independent copied domains' }); copies.push(duplicated.projectId);
    assert(duplicated.complete, 'Native duplicate did not complete'); await verifyDomains(duplicated.projectId, source);
    assert(await inventory(id) === before, 'JSON/ordinary Duplicate changed original file/catalogue');
    return ['Independent ordinary JSON clone and native Duplicate oracle: identical file/image/media ids map to distinct exact inventory references and preserve bytes/source'];
  } finally { for (const copy of copies) await deleteProject(copy); await deleteProject(id); await db.settings.delete('projectDuplicate.operation.review_asset_file_domains'); }
}

export async function reviewAssetFilesBackupPreflightAndLegacy(): Promise<string[]> {
  await import('@/engines');
  const { createProjectZipArchive, importProjectZip, createFullZipArchive, importFullZip } = await import('@/services/zipBackup');
  const id = 'review-files-backup-preflight', copies: string[] = [];
  try {
    const { client, source } = await fixture(id), imported = await client.assets.import(new File(['PREFLIGHT EXACT BYTES'], 'preflight.dat'), 'data');
    await client.assets.installation.set('data', imported.ref, (await client.assets.installation.read()).version);
    const full = await exportFullDatabase(), badFull = structuredClone(full); badFull.localToolAssetFiles[0].sha256 = '0'.repeat(64);
    const before = await inventory(id); let rejected = false;
    try { await importFullDatabase(badFull); } catch { rejected = true; }
    assert(rejected && await inventory(id) === before, 'Corrupt full JSON cleared or changed live inventory before preflight');
    const archive = await createProjectZipArchive(id), zip = await JSZip.loadAsync(await archive.blob.arrayBuffer()), indexName = Object.keys(zip.files).find(name => name.endsWith('/local-tool-assets/index.json'))!;
    assert(indexName, 'ZIP omitted registered file inventory');
    const index = JSON.parse(await zip.file(indexName)!.async('string')); index[0].size++;
    zip.file(indexName, JSON.stringify(index)); const corrupted = await zip.generateAsync({ type: 'uint8array' });
    rejected = false; try { await importProjectZip(new File([corrupted], 'corrupt-files.zip'), { replaceProjectIds: [id] }); } catch { rejected = true; }
    assert(rejected && await inventory(id) === before, 'Corrupt Project ZIP changed inventory/selection before complete preflight');
    await db.localToolAssetFiles.delete(imported.id);
    await importProjectZip(new File([archive.blob], archive.fileName), { replaceProjectIds: [id] });
    const afterZip = await inventory(id);
    assert(afterZip === before, `Real Project ZIP did not restore exact immutable row/bytes: ${JSON.stringify({ before: JSON.parse(before), after: JSON.parse(afterZip) })}`);
    const fullZip = await createFullZipArchive(); await db.localToolAssetFiles.delete(imported.id);
    await importFullZip(new File([fullZip.blob], fullZip.fileName));
    assert(await inventory(id) === before, 'Full ZIP did not restore file rows and selected reference');
    const { localToolAssetFiles: omittedFiles, ...old } = await exportProjectData(id); void omittedFiles; delete old.project!.localToolStates;
    const legacy = await importProjectData(old); copies.push(legacy);
    const oldClient = createLocalToolClient(legacy, source);
    assert(!(await oldClient.assets.choices('data')).length && await (await oldClient.assets.slot('data'))?.blob.text() === 'DEFAULT DATA', 'Legacy JSON absence fabricated file rows or lost packaged fallback');
    return ['Independent backup oracle: corrupt full JSON/Project ZIP reject before clearing; real Project/Full ZIP restore exact bytes and legacy JSON absence stays valid'];
  } finally { for (const copy of copies) await deleteProject(copy); await deleteProject(id); }
}

export async function reviewAssetFilesOwnedWritableImport(): Promise<string[]> {
  const { Editor } = await import('@tiptap/core'), { default: StarterKit } = await import('@tiptap/starter-kit');
  const { SourceToolBlock } = await import('@/engines/local/blocks/SourceToolBlock');
  const { createOwnedBlockClient } = await import('@/engines/local/blocks/client');
  const { defineLocalToolBlock, createLocalToolBlockEnvelope } = await import('@/engines/local/blocks/definitions');
  const { findLocalToolBlocksInHtml, serializeLocalToolBlock } = await import('@/engines/local/blocks/types');
  const { createCodexEntry, updateCodexEntry } = await import('@/db/operations');
  const { testFontBase64 } = await import('./dictionary-test-font');
  const id = 'review-files-owned-import', namespace = 'review.owned-import', ownerId = `${id}-card`, host = document.createElement('div');
  document.body.append(host); let editor: InstanceType<typeof Editor> | undefined, active = true;
  try {
    const base = await fixture(id), fontBytes = Uint8Array.from(atob(testFontBase64), char => char.charCodeAt(0));
    const block = defineLocalToolBlock({ key: 'owned-files', name: { en: 'Independent Owned files', es: 'Archivos Owned' }, scope: 'host', initialState: base.source.initialState, codec: base.source.codec!, validateState: base.source.validateState, component: () => null });
    const source = defineLocalTool({ ...base.source, namespace, blocks: [block], assets: { ...base.source.assets, font: { kind: 'font', path: 'assets/owned.ttf' } }, assetFiles: { ...base.source.assetFiles, 'assets/owned.ttf': async () => new Blob([fontBytes], { type: 'font/ttf' }) } });
    const files = await Promise.all(Object.entries(source.assetFiles!).map(async ([path, load]) => { const blob = await load(); return { path, bytes: blob.size, sha256: await digest(blob) }; }));
    files.push({ path: 'module.tsx', bytes: 0, sha256: await digest(new Blob([])) });
    const manifest = { format: LOCAL_TOOL_SOURCE_FORMAT, apiVersion: 1 as const, namespace, version: '1.0.0', files, contentHash: '' };
    manifest.contentHash = await digest(new Blob([localToolReleaseIdentity(manifest)]));
    registerLocalToolModules({ [`./installed/${namespace}/versions/${manifest.contentHash}/module.tsx`]: { default: source } }, { [`./installed/${namespace}/versions/${manifest.contentHash}/release.json`]: manifest });
    await db.projects.update(id, { enabledEngines: [`local-tool-${namespace}`, 'codex'], localToolInstallations: { [namespace]: { contentHash: manifest.contentHash, revision: 1, updatedAt: 1 } } });
    const envelope = createLocalToolBlockEnvelope(namespace, block, `${id}-atom`);
    await createCodexEntry({ id: ownerId, projectId: id, title: 'Owned writable owner', type: 'location', content: serializeLocalToolBlock(id, envelope), fields: {}, tags: [], relations: [], createdAt: 1, updatedAt: 1 });
    const owner = { kind: 'codex' as const, documentId: ownerId };
    const editorHost = { context: () => ({ projectId: id, owner: () => owner }), editor: () => editor ?? null };
    editor = new Editor({ element: host, extensions: [StarterKit, SourceToolBlock.configure({ host: editorHost, nodeView: false })], content: serializeLocalToolBlock(id, envelope), editable: true });
    const locate = () => {
      assert(active && editor && !editor.isDestroyed && editor.isEditable, 'Owned editor lease expired');
      let position = -1; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'sourceToolBlock' && node.attrs.envelope?.id === envelope.id) position = pos; });
      assert(position >= 0, 'Owned atom missing'); const node = editor.state.doc.nodeAt(position)!;
      assert(node.attrs.projectId === id && node.attrs.envelope.scope === 'host', 'Owned atom context changed');
      return { position, envelope: structuredClone(node.attrs.envelope) as import('@/engines/local/blocks/types').LocalToolOwnedBlockEnvelope };
    };
    const port = { identity: `${id}:real-editor-session`, read: () => locate().envelope,
      subscribe: (changed: () => void) => { editor!.on('transaction', changed); return () => { editor?.off('transaction', changed); }; },
      commit: async (before: import('@/engines/local/blocks/types').LocalToolOwnedBlockEnvelope, next: import('@/engines/local/blocks/types').LocalToolOwnedBlockEnvelope) => {
        const current = locate(); assert(JSON.stringify(current.envelope) === JSON.stringify(before), 'Owned native port CAS conflict');
        editor!.view.dispatch(editor!.state.tr.setNodeMarkup(current.position, undefined, { ...editor!.state.doc.nodeAt(current.position)!.attrs, envelope: next }));
        await updateCodexEntry(ownerId, { content: editor!.getHTML() });
      } };
    const owned = createOwnedBlockClient({ projectId: id }, source, block, owner, port), readonly = createLocalToolClient(id, source, { readOnly: true, assetDefaultsWritable: () => true });
    assert((await owned.assets.slot('font'))?.origin === 'default' && await (await owned.assets.slot('data'))?.blob.text() === 'DEFAULT DATA', 'Owned default assets unavailable before import');
    const before = await inventory(id); let readonlyRejected = false;
    try { await readonly.assets.import(new File(['READONLY CONTROL'], 'readonly-owned.json'), 'data'); } catch { readonlyRejected = true; }
    assert(readonlyRejected && await inventory(id) === before, 'Ordinary readonly client gained import through its installation exception');
    const selected: { kind: 'font' | 'data'; info: Awaited<ReturnType<typeof owned.assets.import>> }[] = [], failures: string[] = [];
    for (const [kind, file] of [['font', new File([fontBytes], 'owned-mime-empty.ttf')], ['data', new File(['{"owned":"LOCAL_DATA"}'], 'owned-mime-empty.json')]] as const) {
      try { selected.push({ kind, info: await owned.assets.import(file, kind) }); } catch (error) { failures.push(`${kind}: ${String(error)}`); }
    }
    assert(!failures.length && selected.length === 2, `Writable Owned client must import both actual font/data files: ${JSON.stringify(failures)}`);
    for (const { kind, info } of selected) {
      assert((await owned.assets.choices(kind)).some(row => row.ref.kind === 'file' && row.ref.id === info.id), `Owned imported ${kind} missing from choices`);
      await owned.assets.installation.set(kind, info.ref, (await owned.assets.installation.read()).version);
      const baseline = await owned.read(); await owned.state!.apply(baseline, [{ type: 'map-set', field: 'assetOverrides', key: kind, value: info.ref }]);
      const documentOverrides = (await owned.read()).data as { assetOverrides: Record<string, { kind: 'file'; id: string }> };
      assert((await owned.assets.slot(kind, documentOverrides.assetOverrides))?.origin === 'document', 'Owned document layer did not use native state selection');
      await owned.assets.installation.set(kind, null, (await owned.assets.installation.read()).version);
      assert((await owned.assets.slot(kind, documentOverrides.assetOverrides))?.ref.kind === 'file', 'Installation Revert erased document selection');
    }
    const stored = findLocalToolBlocksInHtml((await db.codexEntries.get(ownerId))!.content)[0].envelope;
    assert(stored.scope === 'host' && selected.every(row => JSON.stringify(stored.data).includes(row.info.id)), 'Real editor/Codex commit lost imported Owned document refs');
    const staleFile = new File(['STALE OWNER FILE'], 'stale-owned.json'), readBytes = staleFile.arrayBuffer.bind(staleFile), beforeStale = await inventory(id);
    staleFile.arrayBuffer = async () => { const bytes = await readBytes(); active = false; return bytes; };
    let staleRejected = false; try { await owned.assets.import(staleFile, 'data'); } catch { staleRejected = true; }
    assert(staleRejected && await inventory(id) === beforeStale, 'Owner revoked during file preparation still inserted bytes');
    active = true; const rollback = new Error('Owned import outer abort'); let aborted = false;
    try { await db.transaction('rw', db.tables, async () => { await owned.assets.import(new File(['OWNED OUTER ROLLBACK'], 'owned-outer.json'), 'data'); throw rollback; }); } catch (error) { assert(error === rollback, `Owned import did not compose before deliberate outer abort: ${String(error)}`); aborted = true; }
    assert(aborted && await inventory(id) === beforeStale, 'Owned prepared import escaped outer abort');
    return ['Independent real writable Owned editor port imports MIME-empty TTF/JSON, preserves ordinary readonly isolation, native state/document/default layers, stale-owner refusal and outer rollback'];
  } finally { active = false; editor?.destroy(); host.remove(); await deleteProject(id); }
}

export async function reviewAssetFilesSourceReferenceTransaction(): Promise<string[]> {
  const id = 'review-files-source-reference';
  try {
    const { project, source, client } = await fixture(id), document = await createSourceToolDocument({ projectId: id }, NS, 'Source reference transaction');
    const scoped = createLocalToolClient(id, source, { documentId: document.id }), releaseHash = project.localToolInstallations![NS].contentHash;
    const ref = { kind: 'source' as const, namespace: NS, slot: 'data', releaseHash };
    assert(await (await client.assets.resolve(ref))?.blob.text() === 'DEFAULT DATA', 'Exact compiled source ref does not resolve outside the composite transaction');
    const errors: string[] = [];
    for (const level of ['installation', 'document'] as const) {
      const expectedVersion = level === 'installation' ? (await client.assets.installation.read()).version : (await scoped.read()).document!.version;
      const before = await inventory(id), result = await runBridgeTool('wh_local_asset_override', args(id, { slot: 'payload', level, ...(level === 'document' ? { documentId: document.id } : {}), ref, expectedVersion }));
      if (!result.ok) {
        const after = await inventory(id); errors.push(`${level}: ${result.error}; partialWrite=${after !== before}`);
        if (after !== before) console.error('SOURCE_REFERENCE_PARTIAL_WRITE', JSON.stringify({ level, before: JSON.parse(before), after: JSON.parse(after) }));
        continue;
      }
      const overrides = level === 'document' ? ((await scoped.read()).data as { assetOverrides: import('@/engines/local/assets').LocalAssetOverrides }).assetOverrides : undefined;
      const selected = await (level === 'document' ? scoped : client).assets.slot('data', overrides);
      assert(selected?.ref.kind === 'source' && selected.ref.releaseHash === releaseHash && selected.origin === level && await selected.blob.text() === 'DEFAULT DATA', `Successful ${level} source selection lost exact release/hash/bytes/canonical slot`);
    }
    assert(!errors.length, `Legacy source refs must compose through native override transactions for both layers: ${JSON.stringify(errors)}`);
    assert(!(await db.localToolAssetFiles.where('projectId').equals(id).count()), 'Selecting a bundled source ref fabricated an imported file');
    return ['Independent legacy exact source-ref dispatcher oracle: asynchronous compiled loader/SHA validation composes in installation/document transactions and preserves selected release/bytes without file rows'];
  } finally { await deleteProject(id); }
}
