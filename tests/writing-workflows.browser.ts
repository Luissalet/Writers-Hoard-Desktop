import { db } from '@/db';
import { createWritingWorkflow, generateWorkflowStep, listWorkflowMaterials, parseWritingWorkflowDraft, promoteWorkflowStep, saveWritingWorkflow, workflowTemplate } from '@/services/writingWorkflows';
import type { Project } from '@/types';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function testWritingWorkflows(): Promise<string[]> {
  const projectId = `workflow-test-${crypto.randomUUID()}`;
  const otherId = `${projectId}-other`;
  let cloneId: string | undefined;
  const project: Project = { id: projectId, title: 'Workflow test', description: '', mode: 'reporter', type: 'standalone', color: '#123456', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: Date.now(), updatedAt: Date.now() };
  await db.projects.add(project);
  try {
    for (const kind of ['reportage', 'essay', 'narrative'] as const) assert(workflowTemplate(kind, 'en').length === 5, `Missing ${kind} steps`);
    await db.notes.bulkAdd([{ id: `${projectId}-note`, projectId, text: 'Documented fact', kind: 'note', tags: [], pinned: false, createdAt: 1, updatedAt: 1 }, { id: `${projectId}-foreign`, projectId: otherId, text: 'Private elsewhere', kind: 'note', tags: [], pinned: false, createdAt: 1, updatedAt: 1 }]);
    const material = await listWorkflowMaterials(projectId);
    assert(material.length === 1 && material[0].text.includes('Documented fact'), 'Materials must remain scoped to this project');
    await db.citations.add({ id: `${projectId}-citation`, projectId, title: 'Primary source', authors: ['Author'], accessedAt: '2026-09-07', url: 'https://example.org/source', writingIds: [], tags: [], createdAt: 1, updatedAt: 1, researchEvidence: [{ id: 'evidence-test', statement: 'The fact needs review', kind: 'fact', quote: 'Exact original words', locator: 'Page 3', status: 'pending', notes: 'Check date', createdAt: 1, updatedAt: 1 }] });
    const cited = (await listWorkflowMaterials(projectId)).find(m => m.kind === 'citation');
    assert(cited?.text.includes('Exact original words') && cited.text.includes('pending') && cited.text.includes('Page 3') && cited.text.includes('https://example.org/source'), 'Selected citations must carry evidence, location, review status and provenance');
    const original = await createWritingWorkflow(projectId, 'reportage', 'Investigation', 'es');
    assert(parseWritingWorkflowDraft('{"steps":null}') === null && parseWritingWorkflowDraft('broken') === null && parseWritingWorkflowDraft(JSON.stringify(original))?.id === original.id, 'Recovery must validate corrupt data before mounting');
    const noChange = await saveWritingWorkflow(projectId, original);
    assert(noChange.revision === 0 && noChange.history.length === 0, 'Unchanged save must not grow history');
    let missingBlocked = false;
    try { await generateWorkflowStep(projectId, { ...original, materials: [{ kind: 'note', id: `${projectId}-foreign` }] }, original.steps[0].id); } catch { missingBlocked = true; }
    assert(missingBlocked, 'Generation must reject missing or cross-project selected material before contacting AI');
    const draft = structuredClone(original);
    draft.steps[0].output = 'Fact <script>alert(1)</script> & attribution';
    draft.steps[1].skipped = true;
    const saved = await saveWritingWorkflow(projectId, draft);
    assert(saved.history.length === 1 && saved.history[0].steps[0].output === '', 'Save must retain previous output');
    assert((await db.projects.get(projectId))?.writingWorkflows?.[0].steps[1].skipped, 'Skipped steps survive reopening');
    let conflict = false;
    try { await saveWritingWorkflow(projectId, original); } catch { conflict = true; }
    assert(conflict, 'A stale view must not overwrite newer edits');
    const ids = await Promise.all([promoteWorkflowStep(projectId, saved.id, saved.steps[0].id), promoteWorkflowStep(projectId, saved.id, saved.steps[0].id)]);
    assert(ids[0] === ids[1], 'Repeated promotion must be idempotent');
    assert((await db.projects.get(projectId))?.enabledEngines.includes('writings') && (await db.projects.get(projectId))?.engineOrder.includes('writings'), 'Promoted writings must be reachable in the project');
    const writing = await db.writings.get(ids[0]);
    assert(writing?.content.includes('&lt;script&gt;') && !writing.content.includes('<script>'), 'Output must be escaped for rich text');
    const changed = await saveWritingWorkflow(projectId, { ...saved, steps: saved.steps.map((s, i) => i === 0 ? { ...s, output: 'Second version' } : s) });
    const secondId = await promoteWorkflowStep(projectId, changed.id, changed.steps[0].id);
    assert(secondId !== ids[0] && (await db.writings.get(ids[0]))?.content === writing.content, 'New revision must preserve an earlier exported writing');
    const restored = await saveWritingWorkflow(projectId, { ...changed, steps: structuredClone(changed.history[1].steps) }, 'restore');
    assert(restored.steps[0].output === draft.steps[0].output && restored.history.at(-1)?.steps[0].output === 'Second version', 'Restoration must remain reversible');
    assert(await db.notes.get(`${projectId}-note`), 'Source material must survive all operations');
    await saveWritingWorkflow(projectId, { ...restored, materials: [{ kind: 'writing', id: ids[0] }, { kind: 'note', id: `${projectId}-note` }, { kind: 'citation', id: `${projectId}-citation` }] });
    const beforeBackup = (await db.projects.get(projectId))!.writingWorkflows!;
    const archive = await createProjectZipArchive(projectId);
    await db.projects.update(projectId, { writingWorkflows: [] });
    await importProjectZip(new File([archive.blob], 'workflow-project.zip'), { replaceProjectIds: [projectId] });
    assert(JSON.stringify((await db.projects.get(projectId))?.writingWorkflows) === JSON.stringify(beforeBackup), 'ZIP restore must preserve workflows and provenance');
    assert((await listWorkflowMaterials(projectId)).some(m => m.kind === 'citation' && m.text.includes('Exact original words')), 'ZIP restore must preserve research evidence');
    cloneId = await importProjectData(await exportProjectData(projectId));
    const cloned = (await db.projects.get(cloneId))!.writingWorkflows![0];
    assert(cloned.id !== restored.id && cloned.steps[0].output === restored.steps[0].output, 'JSON clone must preserve output with an independent workflow ID');
    assert(cloned.materials.length === 1 && cloned.materials[0].id !== ids[0] && (await db.writings.get(cloned.materials[0].id))?.projectId === cloneId, 'JSON clone must remap included material and drop unavailable references');
    assert(cloned.exports.every(e => e.writingId !== ids[0] && e.writingId !== secondId), 'JSON clone must not point exported results into the original project');
    await db.projects.update(cloneId, { writingWorkflows: [{ ...cloned, exports: [{ stepId: cloned.steps[0].id, output: cloned.steps[0].output, writingId: ids[0] }] }] });
    const repairedId = await promoteWorkflowStep(cloneId, cloned.id, cloned.steps[0].id);
    assert(repairedId !== ids[0] && (await db.writings.get(repairedId))?.projectId === cloneId, 'Corrupt foreign export references must never return a writing from another project');
    assert(await promoteWorkflowStep(cloneId, cloned.id, cloned.steps[0].id) === repairedId, 'Repaired export references must become idempotent');
    return ['workflow templates, selected evidence and project scoping', 'workflow persistence, stale edit protection and reversible history', 'atomic idempotent promotion, escaped text and preserved sources', 'workflow ZIP restore and isolated legacy JSON clone'];
  } finally {
    await db.writings.where('projectId').equals(projectId).delete();
    await db.notes.bulkDelete([`${projectId}-note`, `${projectId}-foreign`]);
    await db.projects.delete(projectId);
    await db.citations.where('projectId').equals(projectId).delete();
    if (cloneId) { await db.writings.where('projectId').equals(cloneId).delete(); await db.projects.delete(cloneId); }
  }
}
