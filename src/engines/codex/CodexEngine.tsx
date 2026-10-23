import { useEraNavigate } from '@/services/worldEras/navigation';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { lazy, Suspense, useState } from 'react';
import { LayoutGrid, Network, Wand2 } from 'lucide-react';
import Modal from '@/components/common/Modal';
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
const NameGenerator = lazy(() => import('@/engines/names/NameGenerator'));

export default function CodexEngine({ projectId }: EngineComponentProps) {
  const scope = useWorldEraScope(projectId);
  const { items: entries, loading, refresh, addItem: addEntry, editItem: editEntry, removeItem: removeEntry } = useCodexEntries(projectId);
  const [view, setView] = useState<'cards' | 'graph'>('cards');
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const [names, setNames] = useState(false);
  const { locale } = useTranslation(); const copy = worldGraphCopy[locale];
  const navigate = useEraNavigate();

  if (loading) return <EngineSpinner />;

  return (
    <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={copy.title}>
      <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${view === 'cards' ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-muted hover:bg-elevated'}`} data-testid="codex-show-cards"><LayoutGrid size={16} />{copy.cards}</button>
      <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${view === 'graph' ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-muted hover:bg-elevated'}`} data-testid="codex-show-graph"><Network size={16} />{copy.graph}</button>
          {!scope.eraId && <button type="button" onClick={() => setNames(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated" data-testid="codex-name-generator"><Wand2 size={16} />{locale === 'es' ? 'Generar un nombre' : 'Generate a name'}</button>}
    </div>
    <Modal open={names} onClose={() => { setNames(false); void refresh(); }} title={locale === 'es' ? 'Generar un nombre' : 'Generate a name'} wide><Suspense fallback={null}><NameGenerator projectId={projectId} locale={locale === 'en' ? 'en' : 'es'} onOpenCard={id => { setNames(false); void refresh().then(() => { setFocusEntryId(id); setView('cards'); navigate(`/project/${projectId}/codex?entry=${encodeURIComponent(id)}`); }); }} /></Suspense></Modal>
    <WikiExportControl key={`wiki-${projectId}`} projectId={projectId} entries={entries} />
    {view === 'graph' ? <Suspense fallback={<EngineSpinner />}><WorldGraphPane projectId={projectId} entries={entries} onOpenEntry={id => { setFocusEntryId(id); setView('cards'); navigate(`/project/${projectId}/codex?entry=${encodeURIComponent(id)}`); }} /></Suspense> : <CodexEntryList
      key={projectId}
      projectId={projectId}
      entries={entries}
      focusEntryId={focusEntryId}
      onAdd={addEntry}
      onEdit={async (id, changes, base) => {
        if (base) {
          await saveCodexDraft(base, changes as CodexEntry, scope);
          await refresh();
        } else await editEntry(id, changes);
      }}
      onDelete={removeEntry}
    />}
    </div>
  );
}
