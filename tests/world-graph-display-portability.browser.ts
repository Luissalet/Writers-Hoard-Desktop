import '@/engines/codex/index';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import type { Project, CodexEntry } from '@/types';
import { saveWorldGraphSettings } from '@/engines/codex/worldGraph/store';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const P = 'graph-display-portable', A = `${P}-nora`, B = `${P}-port`, VIEW = `${P}-view`;
const display = { names: 'hover', nodeSize: 'small', linkOpacity: 0.4, pictures: false } as const;
async function seed() {
  const template = { id: `${P}-template`, name: 'Port official', category: 'character' as const, fields: {}, content: '', revision: 0, createdAt: 1, updatedAt: 1 };
  const project: Project = { id: P, title: 'Graph metadata', description: 'Preserve source', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1,
    codexTemplates: [template], codexGraphLayout: { positions: { [A]: { x: 720, y: -120 }, [B]: { x: 300, y: 100 }, foreign: { x: 900, y: 900 } }, display: { ...display }, hiddenIds: [B, 'missing'], views: [{ id: VIEW, name: 'Harbour view', filters: { focusId: A, templateId: template.id, type: 'character', depth: 2, showIsolated: true }, display: { ...display } }] } };
  await db.projects.put(project);
  const entry = (id: string, title: string, type: CodexEntry['type']): CodexEntry => ({ id, projectId: P, title, type, templateId: type === 'character' ? template.id : undefined, fields: {}, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 });
  await db.codexEntries.bulkPut([entry(A, 'Nora', 'character'), entry(B, 'Port', 'location')]);
}
async function assertClone(targetId: string, expectedDisplay: object = display) {
  const project = (await db.projects.get(targetId))!, layout = project.codexGraphLayout;
  const cards = await db.codexEntries.where('projectId').equals(targetId).toArray(), nora = cards.find(card => card.title === 'Nora')!, port = cards.find(card => card.title === 'Port')!;
  assert(JSON.stringify(layout?.display) === JSON.stringify(expectedDisplay), `Clone lost existing graph display: ${JSON.stringify(layout)}`);
  assert(layout?.positions[nora.id]?.x === 720 && layout.positions[port.id]?.y === 100 && Object.keys(layout.positions).length === 2 && !layout.positions[A], 'Pins retained source or foreign ownership');
  assert(layout.hiddenIds?.join() === port.id, 'Hidden cards lost or retained source/missing IDs');
  const view = layout.views?.[0];
  assert(view && view.id !== VIEW && view.name === 'Harbour view' && view.filters.focusId === nora.id && view.filters.templateId === project.codexTemplates?.[0].id && view.filters.templateId !== `${P}-template`, 'Saved view identities/focus/template were lost or not remapped');
  assert(JSON.stringify(view.display) === JSON.stringify(expectedDisplay) && view.filters.depth === 2, 'Saved view lost its look or non-reference filter');
}
async function runClone(mode: 'json' | 'duplicate'): Promise<string[]> {
  let target = ''; const operationId = crypto.randomUUID();
  try {
    await seed(); const before = JSON.stringify(await db.projects.get(P));
    if (mode === 'json') target = await importProjectData(await exportProjectData(P));
    else { const preview = await previewProjectDuplicate({ projectId: P }); target = (await duplicateProject({ projectId: P, operationId, title: 'Graph copy', expectedSourceVersion: preview.sourceVersion })).projectId; }
    await assertClone(target);
    assert(JSON.stringify(await db.projects.get(P)) === before, 'Cloning mutated the source graph');
    return [`Normal ${mode} clone preserves existing graph display, remaps pins/hidden/view/focus/template identities, removes missing references and leaves source exact`];
  } finally { if (target) await deleteProject(target); await deleteProject(P); await db.settings.delete(`projectDuplicate.operation.${operationId}`); }
}
export const testGraphDisplayJson = () => runClone('json');
export const testGraphDisplayDuplicate = () => runClone('duplicate');
export async function testGraphDisplayZip(): Promise<string[]> {
  try {
    await seed(); const before = JSON.stringify((await db.projects.get(P))!.codexGraphLayout);
    const zip = await createProjectZipArchive(P);
    await db.projects.update(P, { codexGraphLayout: { positions: {} } });
    await importProjectZip(new File([zip.blob], zip.fileName, { type: 'application/zip' }), { replaceProjectIds: [P] });
    assert(JSON.stringify((await db.projects.get(P))!.codexGraphLayout) === before, 'ZIP restore lost graph metadata');
    return ['Normal ZIP restore preserves existing display, pins, hidden cards and saved views'];
  } finally { await deleteProject(P); }
}
export async function testGraphDisplayNewPortable(): Promise<string[]> {
  const targets: string[] = [], operationId = crypto.randomUUID();
  try {
    await seed(); const current = (await db.projects.get(P))!.codexGraphLayout!, next = { ...display, spacing: 1.5, typeAreas: true };
    await saveWorldGraphSettings(P, { display: next, views: current.views!.map(view => ({ ...view, display: next })) });
    const original = JSON.stringify((await db.projects.get(P))!.codexGraphLayout);
    const json = await importProjectData(await exportProjectData(P)); targets.push(json); await assertClone(json, next);
    const preview = await previewProjectDuplicate({ projectId: P }), copied = await duplicateProject({ projectId: P, operationId, title: 'Area copy', expectedSourceVersion: preview.sourceVersion }); targets.push(copied.projectId); await assertClone(copied.projectId, next);
    const zip = await createProjectZipArchive(P); await db.projects.update(P, { codexGraphLayout: { positions: {} } });
    await importProjectZip(new File([zip.blob], zip.fileName, { type: 'application/zip' }), { replaceProjectIds: [P] });
    assert(JSON.stringify((await db.projects.get(P))!.codexGraphLayout) === original, 'New display fields lost in ZIP restore');
    return ['Spacing and typeAreas survive normal JSON clone, Duplicate with remapped graph references and full ZIP restore'];
  } finally { for (const target of targets) await deleteProject(target); await deleteProject(P); await db.settings.delete(`projectDuplicate.operation.${operationId}`); }
}
export async function testGraphDisplayMissingReferences():Promise<string[]> {
  let target='';
  try{
    await seed();const project=(await db.projects.get(P))!,layout=project.codexGraphLayout!;
    await db.projects.update(P,{codexGraphLayout:{...layout,views:[...layout.views!,{id:'orphan-view',name:'Missing targets',filters:{focusId:'foreign-card',templateId:'foreign-template',query:'Keep authored query'},display:{...display}},{id:'sparse-view',name:'No targets',filters:{type:'all'},display:{...display}}]}});
    target=await importProjectData(await exportProjectData(P));const views=(await db.projects.get(target))!.codexGraphLayout!.views!;
    assert(views[1].id!=='orphan-view'&&views[1].filters.focusId===''&&!views[1].filters.templateId&&views[1].filters.query==='Keep authored query','Missing view targets stayed live or erased unrelated filters');
    assert(!Object.hasOwn(views[2].filters,'focusId')&&!Object.hasOwn(views[2].filters,'templateId'),'Absent target filters were filled while cloning');
    await deleteProject(target);target='';await db.projects.update(P,{codexGraphLayout:{positions:{}}});
    target=await importProjectData(await exportProjectData(P));assert(JSON.stringify((await db.projects.get(target))!.codexGraphLayout)==='{"positions":{}}','Legacy positions-only layout gained optional fields');
    return ['JSON clone clears missing view references, preserves sparse filters and leaves positions-only legacy metadata byteexact'];
  }finally{if(target)await deleteProject(target);await deleteProject(P);}
}
