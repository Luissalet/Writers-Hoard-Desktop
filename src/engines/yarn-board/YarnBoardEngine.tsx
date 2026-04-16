import { useState, useMemo } from 'react';
import { Network, Plus, Trash2 } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import NewItemForm from '@/engines/_shared/components/NewItemForm';
import { useAutoSelect, useEnsureDefault } from '@/engines/_shared';
import { useYarnBoards, useYarnBoardData } from './hooks';
import YarnBoard from './components/YarnBoard';
import { generateId } from '@/utils/idGenerator';

export default function YarnBoardEngine({ projectId }: EngineComponentProps) {
  const { items: boards, addItem: addBoard, removeItem: removeBoard } = useYarnBoards(projectId);
  const [activeBoardId, setActiveBoardId] = useState<string>('');
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const { nodes, edges, addNode, updateNode, addEdge, updateEdge, removeNode, removeEdge } = useYarnBoardData(activeBoardId);

  useAutoSelect(boards, activeBoardId, setActiveBoardId);

  useEnsureDefault({
    items: boards,
    loading: false,
    createDefault: () => ({
      id: generateId('board'),
      projectId,
      title: 'Main Board',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    addItem: addBoard,
    onCreated: setActiveBoardId,
  });

  const loading = useMemo(() => boards.length === 0, [boards.length]);

  if (loading) return <EngineSpinner />;

  const handleCreateBoard = async () => {
    const board = {
      id: generateId('board'),
      projectId,
      title: newBoardName.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addBoard(board);
    setActiveBoardId(board.id);
    setNewBoardName('');
    setShowNewBoard(false);
  };

  return (
    <div className="space-y-4">
      {/* Board canvas */}
      {activeBoardId && (
        <YarnBoard
          projectId={projectId}
          boardId={activeBoardId}
          initialNodes={nodes}
          initialEdges={edges}
          onSaveNode={addNode}
          onUpdateNode={updateNode}
          onSaveEdge={addEdge}
          onUpdateEdge={updateEdge}
          onDeleteNode={removeNode}
          onDeleteEdge={removeEdge}
        />
      )}

      {/* Boards dashboard */}
      <div className="border border-border rounded-xl bg-surface/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Network size={14} className="text-accent-gold" />
            Your Boards
          </h3>
          {showNewBoard ? (
            <NewItemForm
              variant="compact"
              value={newBoardName}
              onChange={setNewBoardName}
              placeholder="Board name..."
              onConfirm={handleCreateBoard}
              onCancel={() => {
                setShowNewBoard(false);
                setNewBoardName('');
              }}
            />
          ) : (
            <button
              onClick={() => setShowNewBoard(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
            >
              <Plus size={13} />
              New Board
            </button>
          )}
        </div>

        {boards.length === 0 ? (
          <p className="text-sm text-text-dim text-center py-4">No boards yet. Create one to get started.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {boards.map((board) => {
              const isActive = board.id === activeBoardId;
              return (
                <div
                  key={board.id}
                  className={`group relative rounded-lg border-2 transition cursor-pointer ${
                    isActive ? 'border-accent-gold bg-accent-gold/10' : 'border-border bg-elevated hover:border-accent-gold/40'
                  }`}
                >
                  <button onClick={() => setActiveBoardId(board.id)} className="w-full text-left p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Network size={12} className={isActive ? 'text-accent-gold' : 'text-text-dim'} />
                      <span
                        className={`text-sm font-serif font-semibold truncate ${isActive ? 'text-accent-gold' : 'text-text-primary'}`}
                      >
                        {board.title}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-dim">{new Date(board.createdAt).toLocaleDateString()}</p>
                  </button>

                  {/* Delete button */}
                  {boards.length > 1 && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`Delete board "${board.title}"? All its nodes and connections will be lost.`)) {
                          await removeBoard(board.id);
                          if (activeBoardId === board.id) {
                            const remaining = boards.filter((b) => b.id !== board.id);
                            if (remaining.length > 0) setActiveBoardId(remaining[0].id);
                          }
                        }
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full opacity-0 group-hover:opacity-100 text-text-dim hover:text-danger hover:bg-danger/10 transition"
                      title="Delete board"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
