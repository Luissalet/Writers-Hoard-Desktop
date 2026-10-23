// ============================================
// AI bridge — the project's to-do list
// ============================================
// Read the list (open first, with overdue flags) and change it as the Tasks
// tab does: add, update (text, status, urgency, due day, links), remove.
// Every change can be undone.

import { db } from '@/db';
import { TODO_STATUSES, createTodo, dayFrom, isOpen, isOverdue, sortTodos, type TodoItem, type TodoLink, type TodoStatus } from '@/engines/todos/model';
import { TodoConflict, readTodos, saveTodos } from '@/engines/todos/operations';
import { todosStamp } from '../undoStamp';
import { BridgeError } from './bridgeError';
import { optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from './shared';

async function links(projectId: string, value: unknown): Promise<TodoLink[] | undefined> {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new BridgeError('bad-args', 'links is a list of up to 20 {kind: "writing"|"codex", id}.');
  const out: TodoLink[] = [];
  for (const item of value as { kind?: unknown; id?: unknown }[]) {
    const id = String(item?.id ?? '');
    if (item?.kind === 'writing') { const found = await db.writings.get(id); if (!found || found.projectId !== projectId) throw new BridgeError('not-found', `No chapter ${id} in this project.`); out.push({ kind: 'writing', id, title: found.title || '—' }); }
    else if (item?.kind === 'codex') { const found = await db.codexEntries.get(id); if (!found || found.projectId !== projectId) throw new BridgeError('not-found', `No Codex card ${id} in this project.`); out.push({ kind: 'codex', id, title: found.title || '—' }); }
    else throw new BridgeError('bad-args', 'Each link has kind "writing" or "codex".');
  }
  return out;
}

const shape = (item: TodoItem, today: string) => ({ id: item.id, text: item.text, status: item.status, urgency: item.urgency, ...(item.due ? { due: item.due } : {}), ...(isOverdue(item, today) ? { overdue: true } : {}), links: item.links });

export async function whTodoList(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const list = await readTodos(projectId), today = dayFrom(0), which = optString(args, 'filter') ?? 'open';
  const items = sortTodos(list.items).filter(item => which === 'all' ? true : which === 'open' ? isOpen(item) : which === 'due' ? isOpen(item) && !!item.due : which === 'done' ? !isOpen(item) : true);
  return { revision: list.revision, open: list.items.filter(isOpen).length, today, items: items.map(item => shape(item, today)) };
}

export async function whTodoAction(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const before = await readTodos(projectId), action = requireString(args, 'action');
  const expected = optNumber(args, 'expectedRevision');
  if (expected !== undefined && expected !== before.revision) throw new BridgeError('conflict', `The list is at revision ${before.revision}; read it again.`);
  const status = optString(args, 'status') as TodoStatus | undefined;
  if (status !== undefined && !TODO_STATUSES.includes(status)) throw new BridgeError('bad-args', `status is one of ${TODO_STATUSES.join(', ')}.`);
  const urgency = optNumber(args, 'urgency');
  if (urgency !== undefined && ![0, 1, 2, 3].includes(urgency)) throw new BridgeError('bad-args', 'urgency is 0, 1, 2 or 3.');
  const due = args.due === null ? null : optString(args, 'due');
  const linked = await links(projectId, args.links);
  let items = before.items, id = optString(args, 'id') ?? '';
  try {
    if (action === 'add') {
      const item = createTodo(requireString(args, 'text').slice(0, 500), { ...(status ? { status } : {}), ...(urgency !== undefined ? { urgency: urgency as TodoItem['urgency'] } : {}), ...(due ? { due } : {}), ...(linked ? { links: linked } : {}) });
      items = [...items, item]; id = item.id;
    } else if (action === 'update' || action === 'remove') {
      const found = items.find(item => item.id === id) ?? items.find(item => !id && optString(args, 'match') && item.text.toLocaleLowerCase().includes(optString(args, 'match')!.toLocaleLowerCase()));
      if (!found) throw new BridgeError('not-found', 'No such task; give id (from wh_todo_list) or match (words of its text).');
      id = found.id;
      items = action === 'remove' ? items.filter(item => item !== found) : items.map(item => item !== found ? item : { ...item, ...(optString(args, 'text') ? { text: optString(args, 'text')!.trim().slice(0, 500) } : {}), ...(status ? { status } : {}), ...(urgency !== undefined ? { urgency: urgency as TodoItem['urgency'] } : {}), ...(due === null ? { due: undefined } : due ? { due } : {}), ...(linked ? { links: linked } : {}), updatedAt: Date.now() });
    } else throw new BridgeError('bad-args', 'action is add, update or remove.');
    const saved = await saveTodos(projectId, items, before.revision);
    const item = saved.items.find(entry => entry.id === id);
    return withAudit({ revision: saved.revision, ...(item ? { item: shape(item, dayFrom(0)) } : { removed: id }) }, { projectId, entityId: id, kind: 'update', summary: `${action} a task`, before: { __todos: before, __after: todosStamp(saved), __afterRevision: saved.revision } });
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    if (error instanceof TodoConflict) throw new BridgeError('conflict', 'The list changed meanwhile; read it again.');
    const code = error instanceof Error ? error.message : '';
    throw new BridgeError('bad-args', code === 'todo_due' ? 'due is a day YYYY-MM-DD (or null to clear it).' : code === 'todo_text' ? 'text is 1-500 characters.' : code === 'todo_limit' ? 'Up to 1000 tasks.' : 'Invalid task.');
  }
}
