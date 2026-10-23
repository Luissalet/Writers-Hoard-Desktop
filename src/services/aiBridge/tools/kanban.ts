// ============================================
// AI bridge — kanban boards
// ============================================
// Read the project's boards and change them as the Notes → Boards tab does:
// create a board (with its columns), add / rename / remove a column, add a
// card (with a note and a link to a chapter or card), move it, edit it, remove
// it. Every change can be undone.

import { db } from '@/db';
import { createBoard, moveCard, type KanbanBoard } from '@/engines/kanban/model';
import { KanbanConflict, readKanbans, saveKanbans } from '@/engines/kanban/operations';
import { kanbansStamp } from '../undoStamp';
import { BridgeError } from './bridgeError';
import { optNumber, optString, requireString, resolveProjectId, withAudit, type ToolArgs } from './shared';

export async function whKanban(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  const before = await readKanbans(projectId), action = optString(args, 'action') ?? 'read';
  if (action === 'read') return { revision: before.revision, boards: before.boards };
  let boards = structuredClone(before.boards), detail: Record<string, unknown> = {};
  const board = (): KanbanBoard => { const id = optString(args, 'boardId'); const found = id ? boards.find(item => item.id === id) : boards.length === 1 ? boards[0] : undefined; if (!found) throw new BridgeError('not-found', `Give boardId; boards: ${boards.map(item => `${item.name} (${item.id})`).join(', ') || 'none'}.`); return found; };
  const column = (target: KanbanBoard, key = 'columnId') => { const id = optString(args, key), name = optString(args, key === 'columnId' ? 'column' : 'toColumn'); const found = target.columns.find(item => item.id === id || (!id && name && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())); if (!found) throw new BridgeError('not-found', `No such column; columns: ${target.columns.map(item => `${item.name} (${item.id})`).join(', ')}.`); return found; };
  const link = async () => { const raw = args.link as { kind?: string; id?: string } | null | undefined; if (raw === undefined) return undefined; if (raw === null) return null; const id = String(raw.id ?? ''); if (raw.kind === 'writing') { const found = await db.writings.get(id); if (found?.projectId === projectId) return { kind: 'writing' as const, id, title: found.title || '—' }; } if (raw.kind === 'codex') { const found = await db.codexEntries.get(id); if (found?.projectId === projectId) return { kind: 'codex' as const, id, title: found.title || '—' }; } throw new BridgeError('not-found', 'link is {kind: "writing"|"codex", id} of this project.'); };
  switch (action) {
    case 'create': { const names = Array.isArray(args.columns) && args.columns.length ? (args.columns as unknown[]).map(String) : ['Ideas', 'En curso', 'Revisar', 'Hecho']; const created = createBoard(requireString(args, 'name'), names); boards.push(created); detail = { boardId: created.id }; break; }
    case 'add-column': { const target = board(), added = { id: crypto.randomUUID(), name: requireString(args, 'name').slice(0, 60), cards: [] }; target.columns.push(added); detail = { columnId: added.id }; break; }
    case 'rename-column': { const target = column(board()); target.name = requireString(args, 'name').slice(0, 60); break; }
    case 'remove-column': { const target = board(), found = column(target); if (found.cards.length) throw new BridgeError('bad-args', 'Move or remove its cards first.'); target.columns = target.columns.filter(item => item !== found); break; }
    case 'add-card': { const target = column(board()), linked = await link(); const card = { id: crypto.randomUUID(), title: requireString(args, 'title').slice(0, 300), ...(optString(args, 'note') ? { note: optString(args, 'note')!.slice(0, 4000) } : {}), ...(linked ? { link: linked } : {}) }; target.cards.push(card); detail = { cardId: card.id }; break; }
    case 'move-card': { const target = board(), to = column(target, 'toColumnId'), position = optNumber(args, 'position'); try { const moved = moveCard(target, requireString(args, 'cardId'), to.id, position); boards = boards.map(item => item.id === target.id ? moved : item); } catch { throw new BridgeError('not-found', 'No such card on this board.'); } break; }
    case 'update-card': { const target = board(), card = target.columns.flatMap(item => item.cards).find(item => item.id === requireString(args, 'cardId')); if (!card) throw new BridgeError('not-found', 'No such card.'); const title = optString(args, 'title'); if (title) card.title = title.slice(0, 300); const note = args.note === null ? null : optString(args, 'note'); if (note === null) delete card.note; else if (note !== undefined) card.note = note.slice(0, 4000); const linked = await link(); if (linked === null) delete card.link; else if (linked) card.link = linked; break; }
    case 'remove-card': { const target = board(), cardId = requireString(args, 'cardId'); if (!target.columns.some(item => item.cards.some(card => card.id === cardId))) throw new BridgeError('not-found', 'No such card.'); for (const item of target.columns) item.cards = item.cards.filter(card => card.id !== cardId); break; }
    case 'remove-board': { const target = board(); boards = boards.filter(item => item !== target); break; }
    default: throw new BridgeError('bad-args', 'action is read, create, add-column, rename-column, remove-column, add-card, move-card, update-card, remove-card or remove-board.');
  }
  try {
    const saved = await saveKanbans(projectId, boards, before.revision);
    return withAudit({ revision: saved.revision, boards: saved.boards, ...detail }, { projectId, entityId: projectId, kind: 'update', summary: `${action} on the kanban boards`, before: { __kanbans: before, __after: kanbansStamp(saved), __afterRevision: saved.revision } });
  } catch (error) {
    if (error instanceof KanbanConflict) throw new BridgeError('conflict', 'The boards changed meanwhile; read them again.');
    throw new BridgeError('bad-args', 'Invalid board: names are required; up to 20 columns and 500 cards per board.');
  }
}
