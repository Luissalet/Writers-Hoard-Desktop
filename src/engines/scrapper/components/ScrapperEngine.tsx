// ============================================
// Scrapper Engine — Main Component
// ============================================

import { useState, useMemo } from 'react';
import { Grid3x3, List } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useSnapshots } from '../hooks';
import CaptureBar from './CaptureBar';
import SnapshotCard from './SnapshotCard';
import ManualSnapshotModal from './ManualSnapshotModal';

type ViewMode = 'grid' | 'list';

export default function ScrapperEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: snapshots, loading, addItem: addSnapshot, editItem: editSnapshot, removeItem: removeSnapshot } =
    useSnapshots(projectId);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

  const filteredSnapshots = useMemo(() => {
    if (!searchQuery.trim()) return snapshots;
    const filtered = snapshots.filter(s =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.notes.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.extractedText && s.extractedText.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    return filtered;
  }, [snapshots, searchQuery]);

  if (loading) return <EngineSpinner className="flex items-center justify-center h-64 bg-deep" />;

  return (
    <div className="flex flex-col h-full bg-deep">
      {/* Capture Bar */}
      <CaptureBar
        projectId={projectId}
        onCapture={addSnapshot}
        onManualEntry={() => setIsManualModalOpen(true)}
      />

      {/* Search and Controls */}
      <div className="bg-surface border-b border-border px-4 py-3 flex items-center justify-between gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('scrapper.searchSnapshots')}
          className="flex-1 px-3 py-1.5 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold"
        />
        <div className="flex items-center gap-1 bg-elevated border border-border rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded transition-colors ${
              viewMode === 'grid'
                ? 'bg-accent-gold text-black'
                : 'text-muted hover:text-foreground'
            }`}
            title={t('scrapper.gridView')}
          >
            <Grid3x3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded transition-colors ${
              viewMode === 'list'
                ? 'bg-accent-gold text-black'
                : 'text-muted hover:text-foreground'
            }`}
            title={t('scrapper.listView')}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredSnapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-serif font-semibold text-foreground mb-2">
              {searchQuery ? t('scrapper.noResults') : t('scrapper.noSnapshots')}
            </h3>
            <p className="text-muted text-sm max-w-sm">
              {searchQuery
                ? t('scrapper.adjustSearch')
                : t('scrapper.startCapturing')}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSnapshots.map((snapshot) => (
              <SnapshotCard
                key={snapshot.id}
                snapshot={snapshot}
                onUpdate={editSnapshot}
                onDelete={removeSnapshot}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2 max-w-4xl">
            {filteredSnapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="bg-elevated border border-border rounded-lg p-4 hover:border-accent-gold cursor-pointer transition-all hover:shadow-md"
                onClick={() => {
                  // Open detail modal
                  const card = document.querySelector(`[data-snapshot-id="${snapshot.id}"]`);
                  if (card) card.dispatchEvent(new Event('click', { bubbles: true }));
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-serif font-semibold text-foreground truncate">
                      {snapshot.title}
                    </h4>
                    <a
                      href={snapshot.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-accent-gold hover:underline block truncate mt-1"
                    >
                      {snapshot.url || t('scrapper.manualEntry')}
                    </a>
                    {snapshot.notes && (
                      <p className="text-xs text-muted mt-2 line-clamp-1">{snapshot.notes}</p>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-xs font-medium text-muted uppercase">
                    {snapshot.source}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual Entry Modal */}
      {isManualModalOpen && (
        <ManualSnapshotModal
          projectId={projectId}
          onSave={(snapshot) => {
            addSnapshot(snapshot);
            setIsManualModalOpen(false);
          }}
          onCancel={() => setIsManualModalOpen(false)}
        />
      )}
    </div>
  );
}
