// ============================================
// Storyboard Engine — Main View Component
// ============================================

import { useState, useMemo } from 'react';
import { Plus, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { StoryboardPanel as StoryboardPanelType, Storyboard, StoryboardConnector } from '../types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import type { Scene } from '@/engines/dialog-scene/types';
import StoryboardPanel from './StoryboardPanel';
import PanelEditor from './PanelEditor';
import ConnectorBadge from './ConnectorBadge';
import ConnectorEditor from './ConnectorEditor';

interface StoryboardViewProps {
  storyboard: Storyboard;
  panels: StoryboardPanelType[];
  connectors: StoryboardConnector[];
  onAddPanel: (panel: StoryboardPanelType) => void | Promise<void>;
  onUpdatePanel: (id: string, changes: Partial<StoryboardPanelType>) => void | Promise<void>;
  onDeletePanel: (id: string) => void;
  onReorderPanels: (panelIds: string[]) => void;
  onAddConnector: (connector: StoryboardConnector) => void;
  onUpdateConnector: (id: string, changes: Partial<StoryboardConnector>) => void;
  onDeleteConnector: (id: string) => void;
  onUpdateStoryboard: (id: string, changes: Partial<Storyboard>) => void;
  /** Scenes available for panel↔scene linking. */
  scenes?: Scene[];
}

export default function StoryboardView({
  storyboard,
  panels,
  connectors,
  onAddPanel,
  onUpdatePanel,
  onDeletePanel,
  onReorderPanels,
  onAddConnector,
  onUpdateConnector,
  onDeleteConnector,
  onUpdateStoryboard,
  scenes = [],
}: StoryboardViewProps) {
  const { t } = useTranslation();
  const [editingPanel, setEditingPanel] = useState<StoryboardPanelType | null>(null);
  const [draftPanelId, setDraftPanelId] = useState<string | null>(null);
  const [editingConnectorFrom, setEditingConnectorFrom] = useState<string>('');
  const [editingConnectorTo, setEditingConnectorTo] = useState<string>('');
  const [isReordering, setIsReordering] = useState(false);
  const [draggedPanel, setDraggedPanel] = useState<string | null>(null);

  const sortedPanels = useMemo(() => {
    return [...panels].sort((a, b) => a.order - b.order);
  }, [panels]);

  const getConnectorBetween = (fromId: string, toId: string): StoryboardConnector | undefined => {
    return connectors.find(c => c.sourceId === fromId && c.targetId === toId);
  };

  const handleAddPanel = () => {
    const newPanel: StoryboardPanelType = {
      id: generateId('sbp'),
      storyboardId: storyboard.id,
      projectId: storyboard.projectId,
      // One past the highest `order`, never the row count: after a delete the
      // count can be lower than the last panel's order, and the new panel would
      // tie with (or land before) panels that are already there.
      order: sortedPanels.reduce((max, p) => Math.max(max, p.order), -1) + 1,
      subtitle: '',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setDraftPanelId(newPanel.id);
    setEditingPanel(newPanel);
  };

  const handleSavePanel = async (panel: StoryboardPanelType) => {
    if (draftPanelId === panel.id) {
      await onAddPanel(panel);
      setDraftPanelId(null);
    } else {
      await onUpdatePanel(panel.id, panel);
    }
    setEditingPanel(null);
  };

  const handleDeletePanel = (id: string) => {
    onDeletePanel(id);
  };

  const handleUpdateSubtitle = (id: string, subtitle: string) => {
    onUpdatePanel(id, { subtitle });
  };

  const handleConnectorEdit = (fromId: string, toId: string) => {
    setEditingConnectorFrom(fromId);
    setEditingConnectorTo(toId);
  };

  const handleSaveConnector = (connector: StoryboardConnector) => {
    const existing = getConnectorBetween(connector.sourceId, connector.targetId);
    if (existing) {
      onUpdateConnector(existing.id, connector);
    } else {
      onAddConnector(connector);
    }
  };

  const handleDeleteConnector = (id: string) => {
    onDeleteConnector(id);
  };

  const handleDragStart = (panelId: string) => {
    if (!isReordering) return;
    setDraggedPanel(panelId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropPanel = (targetPanelId: string) => {
    if (!draggedPanel || draggedPanel === targetPanelId || !isReordering) return;

    const draggedIdx = sortedPanels.findIndex(p => p.id === draggedPanel);
    const targetIdx = sortedPanels.findIndex(p => p.id === targetPanelId);

    if (draggedIdx === -1 || targetIdx === -1) return;

    const newPanels = [...sortedPanels];
    const [draggedItem] = newPanels.splice(draggedIdx, 1);
    newPanels.splice(targetIdx, 0, draggedItem);

    const newOrder = newPanels.map(p => p.id);
    onReorderPanels(newOrder);
    setDraggedPanel(null);
  };

  // Group panels into rows based on columns
  const rows = useMemo(() => {
    const rowArray: StoryboardPanelType[][] = [];
    for (let i = 0; i < sortedPanels.length; i += storyboard.columns) {
      rowArray.push(sortedPanels.slice(i, i + storyboard.columns));
    }
    return rowArray;
  }, [sortedPanels, storyboard.columns]);

  const panelEditor = editingPanel && (
    <PanelEditor
      key={editingPanel.id}
      panel={editingPanel}
      isOpen
      onClose={() => { setEditingPanel(null); setDraftPanelId(null); }}
      onSave={handleSavePanel}
      scenes={scenes}
    />
  );

  if (sortedPanels.length === 0) {
    return (
      <div className="space-y-4">
        {panelEditor}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-serif font-bold text-accent-gold">{t('storyboard.viewTitle').replace('{name}', storyboard.title)}</h2>
        </div>
        <div className="border border-border rounded-xl bg-surface/50 p-12 text-center space-y-4">
          <div className="flex justify-center">
            <Zap size={48} className="text-text-muted opacity-50" />
          </div>
          <h3 className="text-lg font-serif font-bold text-text-primary">{t('storyboard.emptyTitle')}</h3>
          <p className="text-text-muted">{t('storyboard.emptyMessage')}</p>
          <button
            onClick={handleAddPanel}
            className="inline-block px-4 py-2 bg-accent-gold text-deep rounded-lg hover:bg-accent-amber transition font-semibold"
          >
            {t('storyboard.addPanel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-serif font-bold text-accent-gold">{t('storyboard.viewTitle').replace('{name}', storyboard.title)}</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-text-muted">{t('storyboard.columnsLabel')}</label>
            <select
              value={storyboard.columns}
              onChange={(e) => onUpdateStoryboard(storyboard.id, { columns: parseInt(e.target.value, 10) })}
              className="px-2 py-1 bg-surface border border-border rounded text-sm text-text-primary focus:border-accent-gold focus:outline-none transition"
            >
              {[2, 3, 4, 5, 6].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setIsReordering(!isReordering)}
            className={`px-3 py-1 rounded text-sm font-semibold transition ${
              isReordering
                ? 'bg-accent-gold text-deep hover:bg-accent-amber'
                : 'bg-surface border border-border text-text-primary hover:border-accent-gold'
            }`}
          >
            {isReordering ? t('storyboard.doneOrdering') : t('storyboard.reorder')}
          </button>
          <button
            onClick={handleAddPanel}
            className="flex items-center gap-1.5 px-3 py-1 bg-accent-gold text-deep rounded font-semibold text-sm hover:bg-accent-amber transition"
          >
            <Plus size={16} />
            {t('storyboard.panelNoun')}
          </button>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="space-y-4">
        <AnimatePresence>
          {rows.map((row, rowIdx) => (
            <motion.div
              key={`row-${rowIdx}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {/* Row of Panels */}
              <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${storyboard.columns}, 1fr)` }}>
                {row.map((panel) => (
                  <div
                    key={panel.id}
                    draggable={isReordering}
                    onDragStart={() => handleDragStart(panel.id)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDropPanel(panel.id)}
                    className={isReordering ? 'opacity-75' : ''}
                  >
                    <StoryboardPanel
                      panel={panel}
                      linkedSceneTitle={
                        panel.linkedSceneId
                          ? scenes.find((sc) => sc.id === panel.linkedSceneId)?.title
                          : undefined
                      }
                      isReordering={isReordering}
                      onEdit={setEditingPanel}
                      onDelete={handleDeletePanel}
                      onUpdateSubtitle={handleUpdateSubtitle}
                    />
                  </div>
                ))}
              </div>

              {/* Connectors between panels in the same row.
                  (The old `rowIdx < rows.length` guard was always true.) */}
              {row.length > 1 && (
                <div className="grid gap-6 grid-rows-subgrid" style={{ gridTemplateColumns: `repeat(${storyboard.columns}, 1fr)` }}>
                  {row.map((panel) => {
                    const panelPosition = row.indexOf(panel);
                    if (panelPosition === row.length - 1) return null; // No connector after last panel
                    const nextPanel = row[panelPosition + 1];
                    const connector = getConnectorBetween(panel.id, nextPanel.id);
                    return (
                      <div key={`conn-${panel.id}-${nextPanel.id}`} className="flex items-center justify-center pb-4">
                        <ConnectorBadge
                          connector={connector || null}
                          fromPanelId={panel.id}
                          toPanelId={nextPanel.id}
                          onEdit={handleConnectorEdit}
                          onDelete={() => connector && handleDeleteConnector(connector.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Connector wrapping to the next row.
                  Exactly ONE, from the last panel of this row to the first of
                  the next — that is the reading order. This used to map over
                  the whole row, so a 3-column board drew three identical
                  badges between every pair of rows, all of them pointing at
                  the same panel. */}
              {(() => {
                const lastOfRow = row[row.length - 1];
                const firstOfNextRow = rows[rowIdx + 1]?.[0];
                if (!lastOfRow || !firstOfNextRow) return null;
                const connector = getConnectorBetween(lastOfRow.id, firstOfNextRow.id);
                return (
                  <div className="my-2 flex justify-center">
                    <ConnectorBadge
                      connector={connector || null}
                      fromPanelId={lastOfRow.id}
                      toPanelId={firstOfNextRow.id}
                      onEdit={handleConnectorEdit}
                      onDelete={() => connector && handleDeleteConnector(connector.id)}
                    />
                  </div>
                );
              })()}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Panel Editor Modal.
          Mounted conditionally and keyed by panel id: PanelEditor seeds
          formData/previewImage from `panel` in useState initialisers, which
          only run on mount. Keeping it permanently mounted meant editing panel
          B showed panel A's data and saving overwrote B with A's content. */}
      {panelEditor}

      {/* Connector Editor Modal */}
      <ConnectorEditor
        isOpen={!!editingConnectorFrom}
        connector={getConnectorBetween(editingConnectorFrom, editingConnectorTo) || null}
        storyboardId={storyboard.id}
        fromPanelId={editingConnectorFrom}
        toPanelId={editingConnectorTo}
        onClose={() => {
          setEditingConnectorFrom('');
          setEditingConnectorTo('');
        }}
        onSave={handleSaveConnector}
        onDelete={handleDeleteConnector}
      />
    </div>
  );
}
