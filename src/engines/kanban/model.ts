// Kanban boards: named columns of cards to drag across ("Ideas", "Escribiendo",
// "Revisar", "Hecho"). A card has a title, an optional note and may link to a
// chapter or a Codex card. Kept with the project, saved whole with a revision.
export interface KanbanCard { id: string; title: string; note?: string; link?: { kind: 'writing' | 'codex'; id: string; title: string }; color?: string }
export interface KanbanColumn { id: string; name: string; cards: KanbanCard[] }
export interface KanbanBoard { id: string; name: string; columns: KanbanColumn[] }
export interface KanbanList { revision: number; boards: KanbanBoard[] }
export const KANBAN_LIMITS = { boards: 50, columns: 20, cards: 500 } as const;

export function createBoard(name: string, columns: string[]): KanbanBoard {
  return { id: crypto.randomUUID(), name: name.trim().slice(0, 80) || 'Tablero', columns: columns.map(title => ({ id: crypto.randomUUID(), name: title, cards: [] })) };
}

export function validateBoards(boards: KanbanBoard[]): void {
  if (boards.length > KANBAN_LIMITS.boards) throw new Error('kanban_limit');
  for (const board of boards) {
    if (!board.name.trim() || board.columns.length > KANBAN_LIMITS.columns) throw new Error('kanban_shape');
    if (board.columns.reduce((sum, column) => sum + column.cards.length, 0) > KANBAN_LIMITS.cards) throw new Error('kanban_cards');
    for (const column of board.columns) { if (!column.name.trim()) throw new Error('kanban_shape'); for (const card of column.cards) if (!card.title.trim() || card.title.length > 300 || (card.note?.length ?? 0) > 4000) throw new Error('kanban_card'); }
  }
}

/** Move a card to a column at a position (end when omitted); returns a new board. */
export function moveCard(board: KanbanBoard, cardId: string, toColumnId: string, index?: number): KanbanBoard {
  const next = structuredClone(board); let card: KanbanCard | undefined;
  for (const column of next.columns) { const at = column.cards.findIndex(item => item.id === cardId); if (at >= 0) { card = column.cards.splice(at, 1)[0]; break; } }
  const target = next.columns.find(column => column.id === toColumnId);
  if (!card || !target) throw new Error('kanban_move');
  target.cards.splice(index === undefined ? target.cards.length : Math.max(0, Math.min(target.cards.length, index)), 0, card);
  return next;
}

export function searchCards(board: KanbanBoard, query: string): Set<string> {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(), q = fold(query.trim());
  return new Set(board.columns.flatMap(column => column.cards).filter(card => !q || fold(`${card.title} ${card.note ?? ''} ${card.link?.title ?? ''}`).includes(q)).map(card => card.id));
}
