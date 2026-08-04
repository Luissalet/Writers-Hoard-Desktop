import { useCallback, useMemo, useState } from 'react';
import { Network, Trash2 } from 'lucide-react';
import { ConfirmDialog, EngineSpinner, NewItemForm, useAutoSelect, useEnsureDefault } from '@/engines/_shared';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import type { EngineComponentProps } from '@/engines/_types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import { useBoards } from '../hooks';
import type { Board } from '../types';
import BoardCanvas from './BoardCanvas';

export default function BoardEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: boards, loading, addItem, editItem, removeItem } = useBoards(projectId);
  const [activeId, setActiveId] = useState('');
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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

  const handleCreate = useCallback(async () => {
    const board = makeBoard(draftName.trim() || t('board.defaultName'));
    await addItem(board);
    setActiveId(board.id);
    setDraftName('');
    setCreating(false);
  }, [makeBoard, draftName, t, addItem]);

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

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {boards.map((board) => (
            <div key={board.id} className="group relative">
              <button
                type="button"
                onClick={() => setActiveId(board.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  board.id === activeId
                    ? 'border-accent-gold text-accent-gold'
                    : 'border-border text-text-muted hover:text-text-primary'
                }`}
              >
                {board.title}
              </button>
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
            onRenameBoard={(title) => void editItem(active.id, { title })}
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
