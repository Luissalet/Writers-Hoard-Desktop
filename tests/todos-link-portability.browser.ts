import { db } from '@/db';
import { createCodexEntry, createProject, createWriting, deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { createTodo } from '@/engines/todos/model';
import { readTodos, saveTodos } from '@/engines/todos/operations';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';
import { duplicateSnapshotVersion, readProjectDuplicate } from '@/services/projectDuplicate/capture';
import type { Project } from '@/types';

type Flow = 'duplicate' | 'json-import';
const serialized = (value: unknown) => JSON.stringify(value);

async function runTodoLinkPortability(flow: Flow): Promise<string[]> {
  const token = crypto.randomUUID(), projectId = `todo-links-${token}`;
  const writingId = `chapter-${token}`, codexId = `card-${token}`, operationId = crypto.randomUUID();
  const ownedProjects = new Set([projectId]);
  const failures: string[] = [];
  const receipt: Record<string, unknown> = { flow, projectId, writingId, codexId, operationId, phases: [] };
  const phases = receipt.phases as string[];
  const check = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
  let stage = 'setup';
  let originalSource = '';
  let originalSourceVersion = '';
  try {
    const now = Date.now();
    const project: Project = { id: projectId, title: 'Owned task-link fixture', mode: 'custom', type: 'standalone', color: '#cab57d', description: 'Synthetic task links only', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: now, updatedAt: now };
    await createProject(project);
    // createProject inserts exactly the supplied record; it does not seed chapters or cards.
    await createWriting({ id: writingId, projectId, title: 'Owned chapter', content: '<p>Source prose must remain exact.</p>', wordCount: 6, status: 'draft', tags: [], createdAt: now, updatedAt: now });
    await createCodexEntry({ id: codexId, projectId, title: 'Owned card', type: 'character', fields: {}, content: '<p>Source card must remain exact.</p>', tags: [], relations: [], createdAt: now, updatedAt: now });
    const todo = createTodo('Check both source documents', { urgency: 2, due: '2027-01-12', links: [{ kind: 'writing', id: writingId, title: 'Owned chapter' }, { kind: 'codex', id: codexId, title: 'Owned card' }] });
    await saveTodos(projectId, [todo], 0);
    receipt.todoId = todo.id;
    const sourceSnapshot = await readProjectDuplicate(projectId);
    originalSource = serialized(sourceSnapshot);
    originalSourceVersion = await duplicateSnapshotVersion(sourceSnapshot);
    receipt.sourceBeforeVersion = originalSourceVersion;
    phases.push('normal-fixture-created');
    stage = 'normal-flow';
    let targetId: string;
    if (flow === 'duplicate') {
      const preview = await previewProjectDuplicate({ projectId });
      receipt.preview = preview;
      const copied = await duplicateProject({ projectId, title: 'Owned copy', operationId, expectedSourceVersion: preview.sourceVersion });
      receipt.result = copied;
      targetId = copied.projectId;
      ownedProjects.add(targetId);
      check(copied.complete, 'duplicate-completed');
    } else {
      // The file UI serializes an export and parses a fresh object for import.
      // Keep that serialized original; the consuming import need not leave its JS argument pure.
      const exportText = serialized(await exportProjectData(projectId));
      receipt.serializedOriginalExport = exportText;
      receipt.originalIdsStillOccupied = {
        project: !!await db.projects.get(projectId),
        writing: (await db.writings.get(writingId))?.projectId === projectId,
        codex: (await db.codexEntries.get(codexId))?.projectId === projectId,
      };
      const input = JSON.parse(exportText) as Parameters<typeof importProjectData>[0];
      targetId = await importProjectData(input);
      ownedProjects.add(targetId);
      receipt.exportTextUnchanged = serialized(JSON.parse(exportText)) === exportText;
      check(receipt.exportTextUnchanged, 'serialized-export-preserved');
    }
    receipt.targetId = targetId;
    phases.push('normal-flow-returned');
    stage = 'identity-observation';
    const [target, writings, cards, tasks] = await Promise.all([
      db.projects.get(targetId), db.writings.where('projectId').equals(targetId).toArray(),
      db.codexEntries.where('projectId').equals(targetId).toArray(), readTodos(targetId),
    ]);
    receipt.observed = { targetExists: !!target, writings: writings.map(({ id, projectId, title, content }) => ({ id, projectId, title, content })), cards: cards.map(({ id, projectId, title, content }) => ({ id, projectId, title, content })), tasks };
    check(targetId !== projectId && !!target, 'destination-is-new-project');
    check(writings.length === 1 && cards.length === 1, 'destination-has-one-chapter-and-one-card');
    check(writings.every(row => row.projectId === targetId && row.id !== writingId), 'chapter-is-new-and-destination-owned');
    check(cards.every(row => row.projectId === targetId && row.id !== codexId), 'card-is-new-and-destination-owned');
    check(tasks.items.length === 1, 'destination-has-one-task');
    const linked = tasks.items[0]?.links ?? [];
    check(linked.length === 2, 'destination-task-retains-two-links');
    for (const [kind, rows] of [['writing', writings], ['codex', cards]] as const) {
      const links = linked.filter(link => link.kind === kind);
      check(links.length === 1 && rows.length === 1 && links[0].id === rows[0].id, `${kind}-task-link-matches-real-destination-id`);
      const linkedRow = links.length === 1 ? kind === 'writing' ? await db.writings.get(links[0].id) : await db.codexEntries.get(links[0].id) : undefined;
      check(linkedRow?.projectId === targetId, `${kind}-task-link-resolves-in-destination`);
    }
    const afterSource = await readProjectDuplicate(projectId);
    receipt.sourceAfterVersion = await duplicateSnapshotVersion(afterSource);
    receipt.sourceExact = serialized(afterSource) === originalSource;
    check(receipt.sourceExact && receipt.sourceAfterVersion === originalSourceVersion, 'source-snapshot-exact');
    phases.push('identity-and-source-checked');
  } catch (error) {
    receipt.runtimeError = { stage, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
    failures.push(`runtime-error-at-${stage}`);
  } finally {
    try {
      // Only the private fixture and destinations returned by the normal operation are owned.
      for (const id of [...ownedProjects].reverse()) await deleteProject(id);
      await db.settings.delete(`projectDuplicate.operation.${operationId}`);
      const remainingProjects = await db.projects.toArray();
      const remainingOwnedRows = await Promise.all(db.tables.map(async table => ({ table: table.name, count: (await table.toArray()).filter(row => ownedProjects.has(String(row.projectId ?? row.seriesId ?? '')) || table.name === 'projects' && ownedProjects.has(String(row.id)) || table.name === 'settings' && row.key === `projectDuplicate.operation.${operationId}`).length })));
      receipt.cleanup = { ownedProjects: [...ownedProjects], remainingProjects: remainingProjects.map(row => row.id), remainingOwnedRows: remainingOwnedRows.filter(row => row.count > 0) };
      check(!remainingProjects.some(row => ownedProjects.has(row.id)) && !remainingOwnedRows.some(row => row.count > 0), 'private-fixture-cleanup');
      phases.push('private-fixture-cleaned');
    } catch (error) {
      receipt.cleanupError = error instanceof Error ? error.message : String(error);
      failures.push('private-fixture-cleanup-error');
    }
  }
  receipt.failures = failures;
  if (failures.length) throw Error(`TODO_LINK_PORTABILITY_RED ${serialized(receipt)}`);
  return [`TODO_LINK_PORTABILITY_PASS ${serialized(receipt)}`];
}

export function testTodoLinksDuplicate() { return runTodoLinkPortability('duplicate'); }
export function testTodoLinksJsonImport() { return runTodoLinkPortability('json-import'); }

async function runTodoLinkMetadata(flow: Flow, legacy: boolean): Promise<string> {
  const token = crypto.randomUUID(), projectId = `todo-metadata-${token}`, operationId = crypto.randomUUID();
  const missingWriting = `missing-writing-${token}`, missingCodex = `missing-card-${token}`;
  const projects = new Set([projectId]), failures: string[] = [];
  const receipt: Record<string, unknown> = { flow, legacy, projectId, operationId };
  const check = (value: unknown, message: string) => { if (!value) failures.push(message); };
  try {
    const now = Date.now();
    await createProject({ id: projectId, title: 'Owned metadata fixture', mode: 'custom', type: 'standalone', color: '#cab57d', description: 'Owned metadata and unresolved links', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: now, updatedAt: now });
    if (!legacy) {
      // Normal Todo APIs admit semantic links whose documents no longer exist.
      const first = createTodo(`Literal ${missingWriting} prose stays literal`, { status: 'in_progress', urgency: 3, due: '2027-02-15', links: [{ kind: 'writing', id: missingWriting, title: 'Retained chapter title' }, { kind: 'codex', id: missingCodex, title: 'Retained card title' }] });
      const second = createTodo('A dropped task keeps its metadata', { status: 'dropped', urgency: 1, links: [{ kind: 'codex', id: missingCodex, title: 'Second card label' }, { kind: 'writing', id: missingWriting, title: 'Second chapter label' }] });
      await saveTodos(projectId, [first, second], 0);
      await saveTodos(projectId, [second, first], 1);
    }
    const before = await readProjectDuplicate(projectId), sourceTasks = await readTodos(projectId);
    const sourceVersion = await duplicateSnapshotVersion(before);
    receipt.sourceBeforeVersion = sourceVersion;
    let targetId: string;
    if (flow === 'duplicate') {
      const preview = await previewProjectDuplicate({ projectId });
      const result = await duplicateProject({ projectId, title: 'Owned metadata copy', operationId, expectedSourceVersion: preview.sourceVersion });
      targetId = result.projectId;
      projects.add(targetId);
      check(result.complete, 'metadata-duplicate-completed');
    } else {
      const originalExport = serialized(await exportProjectData(projectId));
      targetId = await importProjectData(JSON.parse(originalExport) as Parameters<typeof importProjectData>[0]);
      projects.add(targetId);
    }
    const target = await db.projects.get(targetId), targetTasks = await readTodos(targetId);
    receipt.targetId = targetId;
    receipt.sourceTasks = sourceTasks;
    receipt.targetTasks = targetTasks;
    check(!!target && targetId !== projectId, 'metadata-destination-exists');
    check(await duplicateSnapshotVersion(await readProjectDuplicate(projectId)) === sourceVersion, 'metadata-source-exact-after-copy');
    if (legacy) {
      check(!Object.hasOwn(before.project, 'todos') && !!target && !Object.hasOwn(target, 'todos'), 'legacy-todos-own-property-remains-absent');
    } else {
      // This comparison masks IDs only to test preservation, never to predict a remapped ID.
      const content = (list: typeof sourceTasks) => serialized({ ...list, items: list.items.map(item => ({ ...item, links: item.links.map(link => ({ ...link, id: '<semantic-id>' })) })) });
      check(content(targetTasks) === content(sourceTasks), 'all-task-content-order-revision-preserved-except-link-id');
      const writingLinks = targetTasks.items.flatMap(item => item.links).filter(link => link.kind === 'writing');
      const codexLinks = targetTasks.items.flatMap(item => item.links).filter(link => link.kind === 'codex');
      check(writingLinks.length === 2 && new Set(writingLinks.map(link => link.id)).size === 1 && writingLinks.every(link => link.id !== missingWriting), 'missing-writing-maps-once-to-new-identity');
      check(codexLinks.length === 2 && new Set(codexLinks.map(link => link.id)).size === 1 && codexLinks.every(link => link.id !== missingCodex), 'missing-card-maps-once-to-new-identity');
      check(!await db.writings.where('projectId').equals(targetId).count() && !await db.codexEntries.where('projectId').equals(targetId).count(), 'missing-links-do-not-invent-documents');
      // A normal source document can appear later at the previously missing ID.
      await createWriting({ id: missingWriting, projectId, title: 'Later source chapter', content: '<p>New source prose.</p>', wordCount: 3, status: 'draft', tags: [], createdAt: now, updatedAt: now });
      await createCodexEntry({ id: missingCodex, projectId, title: 'Later source card', type: 'character', fields: {}, content: '<p>New source card.</p>', tags: [], relations: [], createdAt: now, updatedAt: now });
      receipt.sourceDocumentsReappeared = { writing: (await db.writings.get(missingWriting))?.projectId, codex: (await db.codexEntries.get(missingCodex))?.projectId };
      for (const link of writingLinks) check(!await db.writings.get(link.id), 'missing-writing-stays-unresolved-after-source-appears');
      for (const link of codexLinks) check(!await db.codexEntries.get(link.id), 'missing-card-stays-unresolved-after-source-appears');
      check(serialized(await readTodos(projectId)) === serialized(sourceTasks), 'source-task-metadata-stays-exact');
      check(serialized(await readTodos(targetId)) === serialized(targetTasks), 'destination-task-metadata-stays-exact-after-source-appears');
    }
  } catch (error) {
    receipt.runtimeError = error instanceof Error ? error.stack : String(error);
    failures.push('metadata-runtime-error');
  } finally {
    try {
      for (const id of [...projects].reverse()) await deleteProject(id);
      await db.settings.delete(`projectDuplicate.operation.${operationId}`);
      const remainingOwnedRows = await Promise.all(db.tables.map(async table => ({ table: table.name, count: (await table.toArray()).filter(row => projects.has(String(row.projectId ?? row.seriesId ?? '')) || table.name === 'projects' && projects.has(String(row.id)) || table.name === 'settings' && row.key === `projectDuplicate.operation.${operationId}`).length })));
      receipt.cleanup = remainingOwnedRows.filter(row => row.count > 0);
      check(!remainingOwnedRows.some(row => row.count > 0), 'metadata-private-fixture-cleanup');
    } catch (error) {
      receipt.cleanupError = String(error);
      failures.push('metadata-private-fixture-cleanup-error');
    }
  }
  receipt.failures = failures;
  if (failures.length) throw Error(`TODO_LINK_METADATA_RED ${serialized(receipt)}`);
  return `TODO_LINK_METADATA_PASS ${serialized(receipt)}`;
}

export async function testTodoLinkMetadata() {
  const out: string[] = [];
  for (const flow of ['duplicate', 'json-import'] as const) {
    out.push(await runTodoLinkMetadata(flow, true));
    out.push(await runTodoLinkMetadata(flow, false));
  }
  return out;
}
