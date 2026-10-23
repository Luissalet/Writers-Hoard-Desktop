// The project's to-do list: what is left to write, research or fix, with a
// status, an urgency (0-3), an optional due day and links to the documents it
// is about (a chapter, a Codex card).
export const TODO_STATUSES = ['todo', 'in_progress', 'done', 'dropped'] as const;
export type TodoStatus = typeof TODO_STATUSES[number];
export interface TodoLink { kind: 'writing' | 'codex'; id: string; title: string }
export interface TodoItem { id: string; text: string; status: TodoStatus; urgency: 0 | 1 | 2 | 3; due?: string; links: TodoLink[]; createdAt: number; updatedAt: number }
export interface TodoList { revision: number; items: TodoItem[] }

export const TODO_LIMIT = 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validateTodo(item: TodoItem): void {
  if (!item.text.trim() || item.text.length > 500) throw new Error('todo_text');
  if (!TODO_STATUSES.includes(item.status)) throw new Error('todo_status');
  if (![0, 1, 2, 3].includes(item.urgency)) throw new Error('todo_urgency');
  if (item.due !== undefined && (!ISO_DAY.test(item.due) || Number.isNaN(Date.parse(`${item.due}T00:00:00Z`)))) throw new Error('todo_due');
  if (item.links.length > 20 || item.links.some(link => !['writing', 'codex'].includes(link.kind) || !link.id)) throw new Error('todo_links');
}

export function createTodo(text: string, extra: Partial<Omit<TodoItem, 'id' | 'text' | 'createdAt' | 'updatedAt'>> = {}): TodoItem {
  const now = Date.now();
  const item: TodoItem = { id: crypto.randomUUID(), text: text.trim(), status: extra.status ?? 'todo', urgency: extra.urgency ?? 0, ...(extra.due ? { due: extra.due } : {}), links: extra.links ?? [], createdAt: now, updatedAt: now };
  validateTodo(item);
  return item;
}

/** A local calendar day as YYYY-MM-DD, `offset` days from `from`. */
export function dayFrom(offset: number, from = new Date()): string {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}
/** Next Monday (a "next week" preset). */
export function nextWeek(from = new Date()): string { const add = ((8 - from.getDay()) % 7) || 7; return dayFrom(add, from); }

export const isOpen = (item: TodoItem) => item.status === 'todo' || item.status === 'in_progress';
export const isOverdue = (item: TodoItem, today = dayFrom(0)) => isOpen(item) && !!item.due && item.due < today;

/** Open first, then by urgency (high first), then by due day (soonest first, none last), then oldest. */
export function sortTodos(items: TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.urgency - a.urgency || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt - b.createdAt);
}
