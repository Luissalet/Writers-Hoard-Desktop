import NewThreadComposer from './NewThreadComposer';
import {useWorldEraScope} from '@/services/worldEras/hooks';
import CommentThreadList from './CommentThreadList';
// ============================================
// Annotations Engine — Project-level dashboard
// ============================================
//
// Cross-cutting read-only view. Lists every annotation in the project,
// grouped by source engine, with orphan count pinned at the top so the user
// can fix drifted anchors in one place.

import { useMemo, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import { useAnnotationsForProject } from '../hooks';
import ReadErrorNotice from '@/components/common/ReadErrorNotice';
import type { AnnotationWithReference } from '../types';

export default function AnnotationsEngine({ projectId }: EngineComponentProps) {
  const { t,locale } = useTranslation();
  const scope=useWorldEraScope(projectId);
  const { items, loading, error, refetching, refresh } = useAnnotationsForProject(projectId);
  const [query, setQuery] = useState('');
  const [onlyOrphans, setOnlyOrphans] = useState(false),[engine,setEngine]=useState(''),[composing,setComposing]=useState(false);
  const orphanCount = items.filter(ann => ann.isOrphaned).length;
  const search = foldText(query.trim());

  const grouped = useMemo(() => {
    const map = new Map<string, AnnotationWithReference[]>();
    for (const ann of items) {
      if(engine&&ann.sourceEngineId!==engine)continue;
      if (onlyOrphans && !ann.isOrphaned) continue;
      if (search && !foldText(`${ann.noteBody ?? ''} ${ann.anchor.selectedText ?? ''} ${(ann.replies??[]).map(reply=>reply.body).join(' ')} ${(ann.mentionTitles??[]).join(' ')}`).includes(search)) continue;
      const list = map.get(ann.sourceEngineId) ?? [];
      list.push(ann);
      map.set(ann.sourceEngineId, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items, search, onlyOrphans,engine]);

  if (loading) return <EngineSpinner />;
  if (error) return <ReadErrorNotice onRetry={refresh} retrying={refetching} />;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-serif font-semibold text-text-primary flex items-center gap-2">
          <MessageSquare size={15} className="text-accent-gold" />
          {t('annotations.dashboard.title')}
        </h2>
        <button
          onClick={() => refresh()}
          className="min-h-9 px-3 py-1.5 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition"
        >
          {t('common.refresh')}
        </button>
      </header>

      <p className="text-sm text-text-muted">{scope.eraId?(locale==='es'?'Comentarios de esta era':'Comments in this era'):(locale==='es'?'Comentarios de Base compartida':'Shared base comments')} · {items.length} · {orphanCount} {t('annotations.card.orphan')} · {items.filter(row=>row.noteType==='reference').length} {t('annotations.dashboard.references')}</p>
      <button type="button" className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated" onClick={()=>setComposing(value=>!value)}>{composing?t('common.cancel'):(locale==='es'?'Nuevo comentario':'New comment')}</button>
      {composing&&<NewThreadComposer key={`new:${JSON.stringify(scope)}`} scope={scope} onDone={()=>setComposing(false)}/>}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('annotations.searchNotes')} placeholder={t('annotations.searchNotes')} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
          <label className="text-xs text-text-muted">{locale==='es'?'Herramienta de origen':'Source tool'} <select aria-label={locale==='es'?'Herramienta de origen':'Source tool'} value={engine} onChange={event=>setEngine(event.target.value)} className="min-h-9 rounded-lg border border-border bg-deep px-2 text-sm text-text-primary"><option value="">{locale==='es'?'Todas':'All'}</option>{[...new Set(items.map(row=>row.sourceEngineId))].map(id=><option key={id}>{id}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={onlyOrphans} onChange={event => setOnlyOrphans(event.target.checked)} />{t('annotations.onlyOrphans')}</label>
          {(query || onlyOrphans || engine) && <button type="button" onClick={() => { setQuery(''); setOnlyOrphans(false);setEngine(''); }} className="px-3 py-2 text-sm text-accent-gold hover:underline">{t('common.resetFilters')}</button>}
        </div>
      )}
      <CommentThreadList key={`threads:${JSON.stringify(scope)}`} items={grouped.flatMap(([,rows])=>rows)} scope={scope} emptyLabel={items.length>0&&grouped.length===0&&(search||onlyOrphans||engine)?t('common.filteredEmpty'):undefined}/>
    </div>
  );
}

function foldText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}
