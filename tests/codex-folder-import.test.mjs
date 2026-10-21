import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodexFolder, previewCodexFolderImport, codexImportId, createCodexFolderImporter } from '../src/engines/genealogy/codexFolderImport.ts';
import { createCodexFolderImportHandlers, CODEX_FOLDER_IMPORT_TOOLS } from '../src/services/aiBridge/tools/codexFolderImport.ts';

const input = (text = '---\nid: original-17\ntitle: Ada\ntype: character\ntags: [one, two]\n---\n# Ada\n\nOriginal **body**.', format = 'obsidian') => ({ format, files: [{ path: 'characters/Ada.md', text }] });

test('edited import plan changes destination title/category/template, skips sources and retains original provenance', async () => {
  const memory = store(), template = { id: 'place', name: 'Harbor', category: 'location', fields: { berths: '2' }, content: '', propertyDefinitions: [{ id: 'berths', key: 'berths', label: 'Berths', kind: 'number' }], revision: 0, createdAt: 1, updatedAt: 1 };
  memory.templates = async () => [template];
  const importer = createCodexFolderImporter(memory, body => `<p>${body}</p>`), source = input();
  source.files.push({ path: 'draft.md', text: 'An excluded unfinished source.' });
  const preview = await importer.preview('project', source);
  source.decisions = [{ id: preview.additions[0].id, title: 'The harbor', type: 'location', templateId: template.id }, { id: preview.additions[1].id, include: false }];
  const applied = await importer.apply('project', source);
  assert.equal(applied.createdIds.length, 1); assert.equal(applied.preview.skipped.length, 1);
  const row = await memory.get(applied.createdIds[0]);
  assert.equal(row.title, 'The harbor'); assert.equal(row.type, 'location'); assert.equal(row.templateId, template.id);
  assert.equal(row.fields.berths, '2'); assert.equal(row.propertyDefinitions[0].id, 'berths');
  assert.equal(row.fields.__importSourceContent, source.files[0].text); assert(row.content.includes('Original **body**.'));
  assert.equal((await importer.preview('project', source)).duplicates.length, 1);
  await importer.undo('project', applied.applyId); assert.equal(memory.rows.size, 0);
});

test('invalid or stale edited plans abort the whole batch and preserve existing documents', async () => {
  const memory = store(), importer = createCodexFolderImporter(memory, text => text), source = input();
  const id = (await importer.preview('project', source)).additions[0].id;
  for (const decisions of [[{ id: 'foreign-id', title: 'Wrong' }], [{ id, title: '' }], [{ id, type: 'unsupported' }], [{ id, templateId: 'retired-template' }], [{ id }, { id }]]) {
    await assert.rejects(() => importer.apply('project', { ...source, decisions })); assert.equal(memory.rows.size, 0);
  }
});
function store() {
  const rows = new Map(); let fail = false;
  return {
    rows, fail: () => { fail = true; },
    list: async p => [...rows.values()].filter(r => r.projectId === p).map(r => structuredClone(r)),
    get: async id => rows.has(id) ? structuredClone(rows.get(id)) : undefined,
    addAll: async entries => { for (const entry of entries) { if (rows.has(entry.id)) throw Error('duplicate key'); rows.set(entry.id, structuredClone(entry)); if (fail) throw Error('private disk failure'); } },
    deleteAll: async ids => { for (const id of ids) rows.delete(id); },
    atomic: async run => { const before = structuredClone(rows); try { return await run(); } catch (error) { rows.clear(); for (const [id,row] of before) rows.set(id,row); throw error; } },
  };
}
for (const format of ['obsidian', 'notion', 'worldanvil', 'campfire']) test(`${format}: body and explicit frontmatter survive parsing`, () => {
  const result = parseCodexFolder(input(undefined, format));
  assert.equal(result.issues.length, 0);
  assert.equal(result.documents[0].type, 'character');
  assert.equal(result.documents[0].explicitId, 'original-17');
  assert.equal(result.documents[0].body, '# Ada\n\nOriginal **body**.');
  assert.equal(result.documents[0].sourceText, input().files[0].text);
  assert.deepEqual(result.documents[0].tags, ['one', 'two']);
});
test('untyped Markdown is a custom note, without guessing character or genealogy', () => {
  const parsed = parseCodexFolder(input('# Family genealogy\nfather: Ada, friend: Bob'));
  assert.equal(parsed.documents[0].type, 'custom');
  assert.equal(parsed.documents[0].fields.importType, 'note');
});
test('Obsidian multiline tags/aliases and quoted title work; nested metadata preserves document with notice', () => {
  const source='---\nid: "explicit:42"\ntitle: "Quoted: title"\ntype: location\ntags:\n  - library\n  - quiet\naliases:\n  - Main hall\ncustom:\n  nested: kept\n---\nFull body survives.';
  const parsed=parseCodexFolder(input(source));
  assert.equal(parsed.documents.length,1);assert.equal(parsed.documents[0].title,'Quoted: title');assert.equal(parsed.documents[0].explicitId,'explicit:42');
  assert.deepEqual(parsed.documents[0].tags,['library','quiet']);assert.equal(parsed.documents[0].fields.aliases,'["Main hall"]');
  assert.equal(parsed.documents[0].body,'Full body survives.');assert.equal(parsed.documents[0].sourceText,source);assert.equal(parsed.issues[0].code,'unmodeled_fields');
});
test('nested JSON body is explicitly reported and complete source retained', () => {
  const source=JSON.stringify({title:'Nested export',content:{blocks:['kept in source']}});
  const parsed=parseCodexFolder({format:'campfire',files:[{path:'nested.json',text:source}]});
  assert.equal(parsed.documents[0].sourceText,source);assert.equal(parsed.issues[0].code,'unmodeled_fields');assert.equal(parsed.documents[0].body,'');
});
test('Campfire typed collections preserve bodies and explicit ids', () => {
  const parsed = parseCodexFolder({ format: 'campfire', files: [{ path: 'export.json', text: JSON.stringify({ characters: [{ id: '42', name: 'Ada', description: 'Whole biography', fields: { role: 'writer' } }], locations: [{ id: 'L', name: 'Library', content: 'Full place description' }] }) }] });
  assert.deepEqual(parsed.documents.map(d => d.type), ['character', 'location']);
  assert.equal(parsed.documents[0].body, 'Whole biography');
  assert.equal(parsed.documents[0].fields.role, 'writer');
  assert.equal(parsed.documents[0].explicitId, '42');
});
test('World Anvil article JSON uses declared type and content', () => {
  const parsed = parseCodexFolder({ format: 'worldanvil', files: [{ path: 'articles.json', text: JSON.stringify({ articles: [{ id: 'abc', title: 'Library', type: 'location', content: 'Text' }] }) }] });
  assert.equal(parsed.documents[0].type, 'location'); assert.equal(parsed.documents[0].body, 'Text');
});
test('Notion exported Markdown properties below title supply explicit metadata without discarding body', () => {
  const source='# Library\n\nType: location\nID: notion-123\nTags: quiet, books\n\nA full description.\nType: prose is kept.';
  const parsed=parseCodexFolder(input(source,'notion'));
  assert.equal(parsed.documents[0].type,'location');assert.equal(parsed.documents[0].explicitId,'notion-123');
  assert.deepEqual(parsed.documents[0].tags,['quiet','books']);assert.equal(parsed.documents[0].body,source);
});
test('empty, malformed, unsupported and repeated files report issues, valid file remains', () => {
  const parsed = parseCodexFolder({ format: 'notion', files: [
    {path:'empty.md',text:''},{path:'bad.md',text:'---\ntitle: open'},
    {path:'bad.json',text:'{'},{path:'same.md',text:'A'},{path:'./same.md',text:'B'},
    {path:'../outside.md',text:'C'},{path:'image.png',text:'D'}, {path:'valid.md',text:'# Good\nKeep it'},
  ] });
  assert.equal(parsed.documents.length,1);assert.equal(parsed.documents[0].title,'Good');
  assert.equal(parsed.issues.length,7);assert.equal(parsed.issues.filter(i=>i.code==='repeated_path').length,2);
});
test('deterministic ids are distinct per project and preserve exact source identity', () => {
  assert.equal(codexImportId('p1','obsidian','a.md'),codexImportId('p1','obsidian','a.md'));
  assert.notEqual(codexImportId('p1','obsidian','a.md'),codexImportId('p2','obsidian','a.md'));
});
test('apply, identical reimport, changed-source conflict, native shape and session undo', async () => {
  const storage=store();const importer=createCodexFolderImporter(storage,body=>`<p>${body}</p>`);
  const first=await importer.apply('p1',input());assert.equal(first.createdIds.length,1);
  const row=storage.rows.get(first.createdIds[0]);assert.equal(row.projectId,'p1');assert.equal(row.fields.__importSourceId,'original-17');assert.equal(row.fields.__importSourceContent,input().files[0].text);
  const repeat=await importer.apply('p1',input());assert.equal(repeat.createdIds.length,0);assert.equal(repeat.preview.duplicates.length,1);assert.equal(storage.rows.size,1);
  const changed=await importer.apply('p1',input('Changed original body'));assert.equal(changed.createdIds.length,0);assert.equal(changed.preview.conflicts.length,1);assert.deepEqual(storage.rows.get(row.id),row);
  const removed=await importer.undo('p1',first.applyId);assert.deepEqual(removed.removedIds,first.createdIds);assert.equal(storage.rows.size,0);
});
test('bulk failure rolls back the entire accepted batch, preserving others', async () => {
  const storage=store();storage.rows.set('other',{id:'other',projectId:'elsewhere'});storage.fail();
  const importer=createCodexFolderImporter(storage,String);
  await assert.rejects(importer.apply('p1',{format:'obsidian',files:[{path:'one.md',text:'One'},{path:'two.md',text:'Two'}]}),/disk failure/);
  assert.deepEqual([...storage.rows.keys()],['other']);
});
test('undo refuses an edited row and removes none of the batch; unrelated rows survive', async () => {
  const storage=store();const importer=createCodexFolderImporter(storage,String);
  const applied=await importer.apply('p1',{format:'obsidian',files:[{path:'one.md',text:'One'},{path:'two.md',text:'Two'}]});
  storage.rows.get(applied.createdIds[1]).avatar='user edit';storage.rows.set('unrelated',{id:'unrelated',projectId:'p1'});
  await assert.rejects(importer.undo('p1',applied.applyId),error=>error.code==='stale_import');assert.equal(storage.rows.size,3);
  await assert.rejects(importer.undo('p2',applied.applyId),error=>error.code==='project_mismatch');
});
test('receipt absence and bridge schemas make session persistence explicit', async () => {
  const importer=createCodexFolderImporter(store(),String);const handlers=createCodexFolderImportHandlers(importer,async args=>args.projectId);
  const result=await handlers.wh_codex_import_undo({projectId:'p1',applyId:'missing'});assert.equal(result.code,'unknown_import');assert.equal(result.ok,false);
  assert.deepEqual(CODEX_FOLDER_IMPORT_TOOLS.map(t=>t.name),['wh_codex_import_preview','wh_codex_import_apply','wh_codex_import_undo']);
  assert.match(CODEX_FOLDER_IMPORT_TOOLS[2].description,/session/);
});
test('preview is pure and preserves manually edited imported bodies on identical reimport', async () => {
  const storage=store();const importer=createCodexFolderImporter(storage,String);const applied=await importer.apply('p1',input());
  storage.rows.get(applied.createdIds[0]).content='Manual body';const before=structuredClone([...storage.rows.values()]);
  const preview=previewCodexFolderImport('p1',input(),before);assert.equal(preview.duplicates.length,1);assert.deepEqual([...storage.rows.values()],before);
});
