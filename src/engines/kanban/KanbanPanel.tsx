// Kanban boards: columns of cards dragged across (or moved with the arrows),
// add and rename columns, add cards with a note and a link to a chapter or a
// Codex card, search the cards. Several boards per project.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Plus, Search, Trash2, X } from 'lucide-react';
import { db } from '@/db';
import { KANBAN_LIMITS, createBoard, moveCard, searchCards, type KanbanBoard, type KanbanCard } from './model';
import { KanbanConflict, saveKanbans } from './operations';

const control = 'min-h-8 rounded border border-border bg-deep px-2 text-xs text-text-primary';
const button = 'inline-flex min-h-8 items-center gap-1 rounded border border-border px-2 text-xs text-text-primary hover:bg-elevated disabled:opacity-50';
const CARD_MIME = 'application/x-wh-kanban-card';

export default function KanbanPanel({ projectId, locale, onOpenLink }: { projectId: string; locale: 'es' | 'en'; onOpenLink?: (link: NonNullable<KanbanCard['link']>) => void }) {
  const es = locale === 'es';
  const list = useLiveQuery(async () => (await db.projects.get(projectId))?.kanbans ?? { revision: 0, boards: [] }, [projectId]);
  const documents = useLiveQuery(async () => [
    ...(await db.writings.where('projectId').equals(projectId).toArray()).map(item => ({ kind: 'writing' as const, id: item.id, title: item.title || '—' })),
    ...(await db.codexEntries.where('projectId').equals(projectId).toArray()).map(item => ({ kind: 'codex' as const, id: item.id, title: item.title || '—' })),
  ], [projectId]);
  const [selected, setSelected] = useState(''), [name, setName] = useState(''), [query, setQuery] = useState(''), [drafts, setDrafts] = useState<Record<string, string>>({}), [newColumn, setNewColumn] = useState(''), [error, setError] = useState('');
  const boards = useMemo(() => list?.boards ?? [], [list]);
  const board = boards.find(item => item.id === selected) ?? boards[0];
  const matches = useMemo(() => board ? searchCards(board, query) : new Set<string>(), [board, query]);
  const save = async (change: (boards: KanbanBoard[]) => KanbanBoard[]) => {
    if (!list) return; setError('');
    try { await saveKanbans(projectId, change(structuredClone(list.boards)), list.revision); }
    catch (failure) { setError(failure instanceof KanbanConflict ? (es ? 'Cambió en otra ventana; vuelve a intentarlo.' : 'Changed in another window; try again.') : (es ? 'No se pudo guardar (¿demasiadas tarjetas o un título vacío?).' : 'Could not save (too many cards or an empty title?).')); }
  };
  const editBoard = (change: (board: KanbanBoard) => KanbanBoard | void) => { if (!board) return; void save(all => all.map(item => { if (item.id !== board.id) return item; const copy = structuredClone(item); return change(copy) ?? copy; })); };
  const move = (cardId: string, columnId: string, index?: number) => editBoard(current => moveCard(current, cardId, columnId, index));
  return <section className="space-y-3 p-4" data-testid="kanban" aria-label={es ? 'Tableros' : 'Boards'}>
    <div className="flex flex-wrap items-center gap-2">
      {boards.length > 0 && <select className={control} aria-label={es ? 'Tablero' : 'Board'} data-testid="kanban-select" value={board?.id ?? ''} onChange={event => setSelected(event.target.value)}>{boards.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <form className="inline-flex gap-1" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; const created = createBoard(name, es ? ['Ideas', 'En curso', 'Revisar', 'Hecho'] : ['Ideas', 'In progress', 'Review', 'Done']); void save(all => [...all, created]).then(() => setSelected(created.id)); setName(''); }}><input className={control} placeholder={es ? 'Nuevo tablero…' : 'New board…'} aria-label={es ? 'Nombre del tablero' : 'Board name'} data-testid="kanban-name" value={name} onChange={event => setName(event.target.value)} /><button type="submit" className={button} data-testid="kanban-create" disabled={!name.trim() || boards.length >= KANBAN_LIMITS.boards}><Plus className="h-3 w-3" />{es ? 'Crear' : 'Create'}</button></form>
      {board && <label className="relative ml-auto"><Search className="absolute left-2 top-2 h-3 w-3 text-text-muted" /><input className={`${control} pl-6`} placeholder={es ? 'Buscar tarjetas' : 'Search cards'} aria-label={es ? 'Buscar tarjetas' : 'Search cards'} data-testid="kanban-search" value={query} onChange={event => setQuery(event.target.value)} /></label>}
      {board && <button type="button" className={button} data-testid="kanban-delete" onClick={() => { void save(all => all.filter(item => item.id !== board.id)); setSelected(''); }}><Trash2 className="h-3 w-3" />{es ? 'Borrar tablero' : 'Delete board'}</button>}
    </div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {!boards.length && <p className="text-sm text-text-muted">{es ? 'Un tablero de columnas para mover tarjetas: ideas, capítulos por revisar, lo que falta del mundo.' : 'A board of columns to move cards across: ideas, chapters to review, what the world still needs.'}</p>}
    {board && <div className="flex gap-3 overflow-x-auto pb-2" data-testid="kanban-columns">
      {board.columns.map((column, columnIndex) => <div key={column.id} className="w-64 shrink-0 space-y-2 rounded-xl border border-border bg-surface/50 p-2" data-testid={`kanban-column-${column.name}`} onDragOver={event => { if (event.dataTransfer.types.includes(CARD_MIME)) event.preventDefault(); }} onDrop={event => { const cardId = event.dataTransfer.getData(CARD_MIME); if (cardId) { event.preventDefault(); move(cardId, column.id); } }}>
        <div className="flex items-center gap-1">
          <input className="min-w-0 flex-1 bg-transparent text-sm font-medium text-text-primary" aria-label={es ? 'Nombre de la columna' : 'Column name'} defaultValue={column.name} key={`${column.id}:${column.name}`} onBlur={event => { const value = event.target.value.trim(); if (value && value !== column.name) editBoard(current => { current.columns[columnIndex].name = value.slice(0, 60); }); else event.target.value = column.name; }} />
          <span className="text-xs text-text-muted" data-testid="kanban-count">{column.cards.length}</span>
          <button type="button" className="rounded p-1 text-text-muted hover:bg-elevated" aria-label={`${es ? 'Quitar columna' : 'Remove column'} ${column.name}`} data-testid="kanban-remove-column" disabled={column.cards.length > 0} title={column.cards.length ? (es ? 'Vacíala antes' : 'Empty it first') : undefined} onClick={() => editBoard(current => { current.columns = current.columns.filter(item => item.id !== column.id); })}><X className="h-3 w-3" /></button>
        </div>
        <ul className="space-y-2">{column.cards.map((card, cardIndex) => <li key={card.id} draggable data-testid="kanban-card" data-card-title={card.title} hidden={!matches.has(card.id)} onDragStart={event => { event.dataTransfer.setData(CARD_MIME, card.id); event.dataTransfer.effectAllowed = 'move'; }} onDrop={event => { const cardId = event.dataTransfer.getData(CARD_MIME); if (cardId && cardId !== card.id) { event.preventDefault(); event.stopPropagation(); move(cardId, column.id, cardIndex); } }} className="cursor-grab space-y-1 rounded-lg border border-border bg-deep p-2 text-xs">
          <p className="text-sm text-text-primary">{card.title}</p>
          {card.note && <p className="whitespace-pre-wrap text-text-muted">{card.note}</p>}
          {card.link && <button type="button" className="text-accent-gold hover:underline" onClick={() => onOpenLink?.(card.link!)}>@{card.link.title}</button>}
          <div className="flex items-center gap-1">
            <button type="button" className="rounded p-1 text-text-muted hover:bg-elevated disabled:opacity-30" aria-label={es ? 'Mover a la columna anterior' : 'Move to the previous column'} data-testid="kanban-left" disabled={columnIndex === 0} onClick={() => move(card.id, board.columns[columnIndex - 1].id)}><ArrowLeft className="h-3 w-3" /></button>
            <button type="button" className="rounded p-1 text-text-muted hover:bg-elevated disabled:opacity-30" aria-label={es ? 'Mover a la columna siguiente' : 'Move to the next column'} data-testid="kanban-right" disabled={columnIndex === board.columns.length - 1} onClick={() => move(card.id, board.columns[columnIndex + 1].id)}><ArrowRight className="h-3 w-3" /></button>
            <select className={`${control} ml-auto max-w-28`} aria-label={es ? 'Enlazar' : 'Link'} value={card.link ? `${card.link.kind}:${card.link.id}` : ''} onChange={event => { const [kind, id] = event.target.value.split(':'); const found = documents?.find(doc => doc.kind === kind && doc.id === id); editBoard(current => { const target = current.columns[columnIndex].cards.find(item => item.id === card.id); if (target) { if (found) target.link = found; else delete target.link; } }); }}><option value="">{es ? 'Sin enlace' : 'No link'}</option>{documents?.map(doc => <option key={`${doc.kind}:${doc.id}`} value={`${doc.kind}:${doc.id}`}>{doc.title}</option>)}</select>
            <button type="button" className="rounded p-1 text-text-muted hover:bg-elevated" aria-label={`${es ? 'Quitar tarjeta' : 'Remove card'} ${card.title}`} data-testid="kanban-remove-card" onClick={() => editBoard(current => { current.columns[columnIndex].cards = current.columns[columnIndex].cards.filter(item => item.id !== card.id); })}><Trash2 className="h-3 w-3" /></button>
          </div>
        </li>)}</ul>
        <form className="flex gap-1" onSubmit={event => { event.preventDefault(); const title = (drafts[column.id] ?? '').trim(); if (!title) return; editBoard(current => { current.columns[columnIndex].cards.push({ id: crypto.randomUUID(), title: title.slice(0, 300) }); }); setDrafts(previous => ({ ...previous, [column.id]: '' })); }}><input className={`${control} min-w-0 flex-1`} placeholder={es ? 'Nueva tarjeta…' : 'New card…'} aria-label={`${es ? 'Nueva tarjeta en' : 'New card in'} ${column.name}`} data-testid="kanban-new-card" value={drafts[column.id] ?? ''} onChange={event => setDrafts(previous => ({ ...previous, [column.id]: event.target.value }))} /><button type="submit" className={button} data-testid="kanban-add-card" aria-label={es ? 'Añadir tarjeta' : 'Add card'}><Plus className="h-3 w-3" /></button></form>
      </div>)}
      {board.columns.length < KANBAN_LIMITS.columns && <form className="w-48 shrink-0 space-y-1" onSubmit={event => { event.preventDefault(); const title = newColumn.trim(); if (!title) return; editBoard(current => { current.columns.push({ id: crypto.randomUUID(), name: title.slice(0, 60), cards: [] }); }); setNewColumn(''); }}><input className={`${control} w-full`} placeholder={es ? 'Nueva columna…' : 'New column…'} aria-label={es ? 'Nueva columna' : 'New column'} data-testid="kanban-new-column" value={newColumn} onChange={event => setNewColumn(event.target.value)} /><button type="submit" className={button} data-testid="kanban-add-column" disabled={!newColumn.trim()}><Plus className="h-3 w-3" />{es ? 'Columna' : 'Column'}</button></form>}
    </div>}
  </section>;
}
