import { lazy, Suspense, useState } from 'react';
import { LayoutGrid, Network } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useCodexEntries } from './hooks';
import CodexEntryList from '@/components/codex/CodexEntryList';
import { saveCodexDraft } from './operations';
import type { CodexEntry } from '@/types';
import WikiExportControl from './WikiExportControl';
import { useTranslation } from '@/i18n/useTranslation';
import { worldGraphCopy } from './worldGraph/copy';
const WorldGraphPane = lazy(() => import('./worldGraph/WorldGraphPane'));

export default function CodexEngine({ projectId }: EngineComponentProps) {
  const { items: entries, loading, refresh, addItem: addEntry, editItem: editEntry, removeItem: removeEntry } = useCodexEntries(projectId);
  const [view, setView] = useState<'cards' | 'graph'>('cards');
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const { locale } = useTranslation(); const copy = worldGraphCopy[locale];
  const navigate = useNavigate();

  if (loading) return <EngineSpinner />;

  return (
    <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={copy.title}>
      <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${view === 'cards' ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-muted hover:bg-elevated'}`} data-testid="codex-show-cards"><LayoutGrid size={16} />{copy.cards}</button>
      <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${view === 'graph' ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-muted hover:bg-elevated'}`} data-testid="codex-show-graph"><Network size={16} />{copy.graph}</button>
    </div>
    <WikiExportControl key={`wiki-${projectId}`} projectId={projectId} entries={entries} />
    {view === 'graph' ? <Suspense fallback={<EngineSpinner />}><WorldGraphPane projectId={projectId} entries={entries} onOpenEntry={id => { setFocusEntryId(id); setView('cards'); navigate(`/project/${projectId}/codex?entry=${encodeURIComponent(id)}`); }} /></Suspense> : <CodexEntryList
      key={projectId}
      projectId={projectId}
      entries={entries}
      focusEntryId={focusEntryId}
      onAdd={addEntry}
      onEdit={async (id, changes, base) => {
        if (base) {
          await saveCodexDraft(base, changes as CodexEntry);
          await refresh();
        } else await editEntry(id, changes);
      }}
      onDelete={removeEntry}
    />}
    </div>
  );
}
