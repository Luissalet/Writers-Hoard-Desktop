// The list is stored with the project and saved whole with a revision, so two
// windows cannot overwrite each other.
import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import { TODO_LIMIT, validateTodo, type TodoList } from './model';

export class TodoConflict extends Error { constructor() { super('todo_conflict'); this.name = 'TodoConflict'; } }

export async function readTodos(projectId: string): Promise<TodoList> {
  return (await db.projects.get(projectId))?.todos ?? { revision: 0, items: [] };
}

export async function saveTodos(projectId: string, items: TodoList['items'], expectedRevision: number): Promise<TodoList> {
  if (items.length > TODO_LIMIT) throw new Error('todo_limit');
  items.forEach(validateTodo);
  const saved = await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    const current = project.todos ?? { revision: 0, items: [] };
    if (current.revision !== expectedRevision) throw new TodoConflict();
    const next: TodoList = { revision: current.revision + 1, items: structuredClone(items) };
    await db.projects.update(projectId, { todos: next, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
    return next;
  });
  notifyProjectsChanged();
  return saved;
}

/** Put the list back as it was (undo), whatever its revision now. */
export async function restoreTodos(projectId: string, previous: TodoList): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('project_missing');
    await db.projects.update(projectId, { todos: { revision: (project.todos?.revision ?? 0) + 1, items: previous.items }, updatedAt: Math.max(Date.now(), project.updatedAt + 1) });
  });
  notifyProjectsChanged();
}
