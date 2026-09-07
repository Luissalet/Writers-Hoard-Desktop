import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Network, Trash2 } from 'lucide-react';
import { ConfirmDialog, EngineSpinner, NewItemForm, useAutoSelect, useEnsureDefault } from '@/engines/_shared';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import type { EngineComponentProps } from '@/engines/_types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import { useBoards } from '../hooks';
import type { Board } from '../types';
import BoardCanvas from './BoardCanvas';
import { getBoardCopy } from '../copy';
import { getBoardNode } from '../operations';
import { rememberProjectRoute } from '@/services/projectIntelligence';

export default function BoardEngine({ projectId }: EngineComponentProps) {
  const { t, locale } = useTranslation();
  const copy = getBoardCopy(locale);
  const { items: boards, loading, addItem, editItem, removeItem } = useBoards(projectId);
  const [activeId, setActiveId] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const targetId = searchParams.get('node');
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const commitRename = useCallback(() => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (id && title) void editItem(id, { title });
  }, [renamingId, renameDraft, editItem]);

  const makeBoard = useCallback(
    (title: string): Board => ({
      id: generateId('board'),
      projectId,
      title,
      surface: 'cork',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    [projectId],
  );

  const createDefault = useCallback(() => makeBoard(t('board.defaultName')), [makeBoard, t]);

  useEnsureDefault({ items: boards, loading, createDefault, addItem, onCreated: setActiveId });
  useAutoSelect(boards, activeId, setActiveId);

  const active = useMemo(() => boards.find((board) => board.id === activeId), [boards, activeId]);

  useEffect(() => {
    if (!targetId || loading) return;
    let cancelled = false;
    void (async () => {
      const boardId = boards.some((item) => item.id === targetId)
        ? targetId : (await getBoardNode(targetId))?.boardId;
      if (!cancelled && boardId && boards.some((item) => item.id === boardId)) setActiveId(boardId);
    })();
    return () => { cancelled = true; };
  }, [targetId, boards, loading]);

  useEffect(() => {
    if (activeId) rememberProjectRoute(projectId, { engineId: 'board', entityId: activeId });
  }, [activeId, projectId]);

  const handleCreate = useCallback(async () => {
    const board = makeBoard(draftName.trim() || t('board.defaultName'));
    await addItem(board);
    setSearchParams({});
    setActiveId(board.id);
    setDraftName('');
    setCreating(false);
  }, [makeBoard, draftName, t, addItem, setSearchParams]);

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    await removeItem(pendingDelete);
    if (pendingDelete === activeId) {
      const next = boards.find((board) => board.id !== pendingDelete);
      setActiveId(next?.id ?? '');
    }
    setPendingDelete(null);
  }, [pendingDelete, removeItem, activeId, boards]);

  if (loading && boards.length === 0) return <EngineSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-serif text-lg text-accent-gold">
          <Network size={18} /> {t('engines.board.name')}
        </h2>

        {active && <select aria-label={copy.surface} value={active.surface} onChange={(event) => void editItem(active.id, { surface: event.target.value as Board['surface'] })} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-muted focus-visible:outline-2 focus-visible:outline-accent-gold">
          {(['cork', 'slate', 'grid', 'blueprint'] as const).map((surface) => <option key={surface} value={surface}>{copy[surface]}</option>)}
        </select>}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {boards.map((board) => (
            <div key={board.id} className="group relative">
              {renamingId === board.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    else if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="w-28 rounded-lg border border-accent-gold bg-elevated px-2.5 py-1 text-xs text-text-primary outline-none"
                />
              ) : (
              <button
                type="button"
                onClick={() => { setSearchParams({}); setActiveId(board.id); }}
                // Double-click renames. `onRenameBoard` was declared, passed
                // down and then never destructured inside BoardCanvas, and no
                // other surface offered a rename — a board's title was fixed
                // forever at the moment it was created.
                onDoubleClick={() => {
                  setRenamingId(board.id);
                  setRenameDraft(board.title);
                }}
                title={t('board.renameHint')}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  board.id === activeId
                    ? 'border-accent-gold text-accent-gold'
                    : 'border-border text-text-muted hover:text-text-primary'
                }`}
              >
                {board.title}
              </button>
              )}
              {boards.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setPendingDelete(board.id)}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-surface p-0.5 text-text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger"
                  title={t('common.delete')}
                >
                  <Trash2 size={10} />
                </button>
              ) : null}
            </div>
          ))}

          {creating ? (
            <NewItemForm
              variant="compact"
              value={draftName}
              onChange={setDraftName}
              placeholder={t('board.namePlaceholder')}
              onConfirm={handleCreate}
              onCancel={() => {
                setCreating(false);
                setDraftName('');
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-text-muted transition hover:border-accent-gold hover:text-accent-gold"
            >
              + {t('board.newBoard')}
            </button>
          )}
        </div>
      </div>

      {active ? (
        <>
          <BoardCanvas
            key={active.id}
            projectId={projectId}
            board={active}
            onViewportChange={(viewport) => void editItem(active.id, { viewport })}
          />
          <AnnotationSurface
            projectId={projectId}
            engineId="board"
            entityId={active.id}
            layout="stack"
          />
        </>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={t('board.confirmDeleteBoard')}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
