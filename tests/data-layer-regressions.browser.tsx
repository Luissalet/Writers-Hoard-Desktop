// Data-layer regressions found by the 2026-09-24 audit. Each check failed
// against the code it guards before the fix.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/data-layer-regressions.browser.tsx testDataLayerRegressions --no-sandbox
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import JSZip from 'jszip';
import { db } from '@/db';
import { useDebouncedField, type DebouncedField } from '@/engines/_shared/useDebouncedField';
import { countWords, stripHtml } from '@/utils/text';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const P = 'data-layer-regressions-project';

async function replaceGate(): Promise<string> {
  const { scanProjectReplace, applyProjectReplace, forgetReplaceUndo } = await import('@/services/projectReplace');
  const now = Date.now();
  const rows = [
    { id: 'sa-amp', content: '<p>Tom &amp; Jerry llegan.</p>' },
    { id: 'sa-split', content: '<p>Mar<strong>ta</strong> se va.</p>' },
    { id: 'sa-entity', content: '<p>Un caf&eacute; solo.</p>' },
  ];
  await db.writings.bulkAdd(rows.map((row, index) => ({
    id: row.id, projectId: P, title: `C${index}`, status: 'draft' as const, content: row.content,
    wordCount: 3, chapter: index, tags: [], createdAt: now, updatedAt: now,
  })));
  const options = { caseSensitive: false, wholeWord: false, matchDiacritics: false };
  const amp = await scanProjectReplace({ projectId: P, term: 'Tom & Jerry', options, scopes: ['writings'] });
  assert(amp.total === 1, `ampersand term: expected 1, got ${amp.total}`);
  const split = await scanProjectReplace({ projectId: P, term: 'Marta', options, scopes: ['writings'] });
  assert(split.splitTotal === 1, `split-only field: expected 1 split, got ${split.splitTotal}`);
  const entity = await scanProjectReplace({ projectId: P, term: 'café', options, scopes: ['writings'] });
  assert(entity.total === 1, `named entity: expected 1, got ${entity.total}`);
  const outcome = await applyProjectReplace(amp, 'Pinky & Brain', {
    excludedDocuments: new Set(), excludedOccurrences: new Set(),
  });
  assert(outcome.replaced === 1, 'ampersand replace did not apply');
  const after = (await db.writings.get('sa-amp'))?.content;
  assert(after === '<p>Pinky &amp; Brain llegan.</p>', `unexpected rewrite: ${after}`);
  forgetReplaceUndo(outcome.batchId);
  await db.writingSnapshots.where('writingId').anyOf(rows.map(r => r.id)).delete();
  await db.writings.bulkDelete(rows.map(r => r.id));
  return 'replace gate sees through entities and tags';
}

async function branchRemoval(): Promise<string> {
  const { createCreativeBranch, stageBranchRemoval, previewBranchPromotion } = await import('@/services/branching');
  const now = Date.now();
  await db.outlines.add({ id: 'sa-outline', projectId: P, title: 'O', createdAt: now, updatedAt: now } as never);
  await db.outlineBeats.bulkAdd([
    { id: 'sa-beat-a', outlineId: 'sa-outline', projectId: P, order: 0, level: 'beat', title: 'A', description: '', status: 'empty', createdAt: now, updatedAt: now },
    { id: 'sa-beat-b', outlineId: 'sa-outline', projectId: P, order: 1, level: 'beat', title: 'B', description: '', status: 'empty', createdAt: now, updatedAt: now },
  ] as never[]);
  await db.seeds.add({ id: 'sa-seed', projectId: P, title: 'S', description: '', kind: 'object', status: 'planted', linkedBeatId: 'sa-beat-b', tags: [], createdAt: now, updatedAt: now } as never);
  const free = await createCreativeBranch({ projectId: P, title: 'Drop A', rootKind: 'outline-beat', rootId: 'sa-beat-a' });
  await stageBranchRemoval(free.id, 'outline-beat', 'sa-beat-a');
  const freePreview = await previewBranchPromotion(free.id);
  assert(freePreview.canPromote, `removing an unlinked beat was refused: ${JSON.stringify(freePreview.changes.map(c => c.conflict))}`);
  const linked = await createCreativeBranch({ projectId: P, title: 'Drop B', rootKind: 'outline-beat', rootId: 'sa-beat-b' });
  await stageBranchRemoval(linked.id, 'outline-beat', 'sa-beat-b');
  const linkedPreview = await previewBranchPromotion(linked.id);
  assert(!linkedPreview.canPromote && linkedPreview.changes[0]?.conflict === 'invalid-reference', 'a beat a seed points at could be removed');
  await db.creativeBranches.where('projectId').equals(P).delete();
  await db.creativeBranchDeltas.where('projectId').equals(P).delete();
  await db.seeds.delete('sa-seed');
  await db.outlineBeats.where('projectId').equals(P).delete();
  await db.outlines.delete('sa-outline');
  return 'branch removal of an outline beat is decided by real dependants';
}

async function deleteSweepsTiles(): Promise<string> {
  const { deleteProject } = await import('@/db/operations');
  const now = Date.now();
  await db.projects.add({ id: 'sa-doomed', title: 'D', mode: 'custom', type: 'standalone', status: 'active', createdAt: now, updatedAt: now } as never);
  await db.generatedWorlds.add({ id: 'sa-world', projectId: 'sa-doomed', createdAt: now, updatedAt: now } as never);
  await db.canonTiles.add({ id: 'sa-canon', worldId: 'sa-world', savedAt: now, byteLength: 1 } as never);
  await db.renderedTiles.add({ id: 'sa-render', worldId: 'sa-world', savedAt: now, byteLength: 1 } as never);
  await deleteProject('sa-doomed');
  assert(!(await db.canonTiles.get('sa-canon')), 'canon tiles outlived their project');
  assert(!(await db.renderedTiles.get('sa-render')), 'rendered tiles outlived their project');
  return 'project deletion sweeps world tile caches';
}

async function oldFullArchiveKeepsGlobalData(): Promise<string> {
  const { createFullZipArchive, importFullZip } = await import('@/services/zipBackup');
  const { sha256Hex } = await import('@/services/judge/text');
  const now = Date.now();
  await db.projects.add({ id: 'sa-full', title: 'F', mode: 'custom', type: 'standalone', status: 'active', createdAt: now, updatedAt: now } as never);
  const { blob } = await createFullZipArchive();
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  manifest.version = 2;
  delete manifest.referenceLibrary;
  delete manifest.externalAssets;
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.remove('reference-library.json');
  zip.remove('notes-inbox.json');
  const legacy = new File([await zip.generateAsync({ type: 'blob' })], 'old.zip');

  const bytes = new TextEncoder().encode('private original');
  await db.referenceDocuments.add({
    id: 'sa-ref', name: 'Ref', mimeType: 'text/plain', size: bytes.byteLength, sha256: await sha256Hex(bytes),
    version: 1, status: 'ready', original: new Blob([bytes]), createdAt: now, updatedAt: now,
  });
  await db.notes.add({ id: 'sa-inbox', projectId: '__inbox__', kind: 'thought', body: 'keep me', tags: [], pinned: false, createdAt: now, updatedAt: now } as never);
  await importFullZip(legacy);
  assert(await db.referenceDocuments.get('sa-ref'), 'a v2 restore wiped the private reference library');
  assert(await db.notes.get('sa-inbox'), 'a v2 restore wiped the inbox notes it does not carry');
  assert(await db.projects.get('sa-full'), 'the archived project was not restored');
  await db.referenceDocuments.delete('sa-ref');
  await db.notes.delete('sa-inbox');
  return 'an older full archive keeps the global tables it cannot restore';
}

async function legacyImportKeepsSnapshots(): Promise<string> {
  const { importFullDatabase } = await import('@/db/operations');
  const now = Date.now();
  await db.snapshots.put({ id: 'sa-link', projectId: P, url: 'https://example.com', title: 'Enriched', source: 'web', status: 'success', notes: 'my notes', tags: ['kept'], createdAt: now } as never);
  await importFullDatabase({
    version: 1, fullExport: true, exportedAt: now,
    externalLinks: [
      { id: 'sa-link', projectId: P, url: 'https://example.com', title: 'Bare' },
      { id: 'sa-link-new', projectId: P, url: 'https://example.org', title: 'New' },
    ],
  } as never);
  const kept = await db.snapshots.get('sa-link');
  assert(kept?.title === 'Enriched' && kept.notes === 'my notes', 'a legacy import overwrote a live saved link');
  assert(await db.snapshots.get('sa-link-new'), 'a legacy import dropped a link it carried');
  await db.snapshots.bulkDelete(['sa-link', 'sa-link-new']);
  return 'legacy JSON import never overwrites a saved link';
}

async function debouncedFieldUnderStrictMode(): Promise<string> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const saved: string[] = [];
  const out: { current: DebouncedField | null } = { current: null };
  function Field() {
    out.current = useDebouncedField('', (value) => { saved.push(value); }, { delayMs: 5 });
    return null;
  }
  await act(async () => { root.render(<StrictMode><Field /></StrictMode>); });
  await act(async () => { out.current!.onChange('abc'); });
  assert(out.current!.dirty, 'typing did not mark the field dirty');
  await act(async () => { await out.current!.flush(); });
  assert(saved.at(-1) === 'abc', 'the value was not committed');
  assert(!out.current!.dirty, 'a saved field stayed dirty under StrictMode');
  await act(async () => { root.unmount(); });
  host.remove();
  return 'debounced field clears dirty after a save under StrictMode';
}

export async function testDataLayerRegressions(): Promise<string[]> {
  if (!db.isOpen()) await db.open();
  const results: string[] = [];
  const probe = async (name: string, run: () => Promise<string> | string) => {
    try { results.push(`OK ${await run()}`); } catch (error) { results.push(`FAIL ${name}: ${(error as Error).message}`); }
  };
  await probe('stripHtml', () => {
    const got = stripHtml('<p>a &amp;lt; b</p>');
    assert(got === 'a &lt; b', `stripHtml double-decoded: ${got}`);
    return 'stripHtml decodes &amp; last';
  });
  await probe('countWords', () => {
    const cases: Array<[string, number]> = [
      ['  hello   world  ', 2],
      ['<p>Hola</p><p>mundo</p>', 2],
      ['我爱写作。', 4],
      ['今日は良い天気です', 9],
      ['Writers Hoard 是一个应用', 7],
    ];
    for (const [text, expected] of cases) {
      const got = countWords(text);
      assert(got === expected, `countWords(${JSON.stringify(text)}) = ${got}, expected ${expected}`);
    }
    return 'countWords counts CJK per character and ignores its punctuation';
  });
  await probe('replaceGate', replaceGate);
  await probe('branchRemoval', branchRemoval);
  await probe('deleteSweepsTiles', deleteSweepsTiles);
  await probe('legacyImportKeepsSnapshots', legacyImportKeepsSnapshots);
  await probe('debouncedField', debouncedFieldUnderStrictMode);
  await probe('oldFullArchive', oldFullArchiveKeepsGlobalData);
  const failures = results.filter((line) => line.startsWith('FAIL '));
  if (failures.length) throw new Error(failures.join('\n'));
  return results.map((line) => line.slice(3));
}
