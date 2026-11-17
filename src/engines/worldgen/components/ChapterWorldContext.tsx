import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from '@/i18n/useTranslation';
import { chapterWorldContext } from '../weatherContext';
import { weatherCopy } from '../weatherCopy';
import WorldPresence from './WorldPresence';
import { weatherSummary } from '../weatherCopy';
import { useWorldEraScope } from '@/services/worldEras/hooks';

/** Optional manuscript hook: no prose writes and no inferred location. */
export default function ChapterWorldContext({ projectId, writingId, eraId, expanded = false }: { projectId: string; writingId: string; eraId?: string; expanded?: boolean }) {
  const { locale } = useTranslation(), copy = weatherCopy(locale);
  const paneScope = useWorldEraScope(projectId);
  const effectiveEraId = eraId ?? paneScope.eraId;
  const [revision, setRevision] = useState(0);
  const result = useLiveQuery(async () => {
    try { return await chapterWorldContext({ projectId, eraId: effectiveEraId }, writingId); }
    catch { return null; }
  }, [projectId, writingId, effectiveEraId, revision]);
  if (result === undefined) return <p role="status" className="text-xs text-text-secondary">{copy.loading}</p>;
  const retry = <button type="button" className="rounded border border-border px-3 py-2 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold" onClick={() => setRevision(n => n + 1)}>{copy.retry}</button>;
  if (!result) return <div role="status" className="space-y-2 text-xs"><p>{copy.failed}</p>{retry}</div>;
  if (!result.places.length) return <div className="space-y-2 text-xs text-text-secondary"><p>{result.status === 'pending' ? copy.pending : copy.noPlace}</p>{result.status === 'pending' && retry}</div>;
  return <div className="space-y-2 text-xs text-text-secondary" data-testid="chapter-world-context">
    {result.status === 'undated' && <p>{copy.undated}</p>}
    {result.places.map(place => <details key={`${place.worldId}:${place.key}`} open={expanded || undefined} className="rounded-lg border border-border bg-surface p-3">
      <summary className="cursor-pointer text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold">{place.name} · {place.card.weather ? weatherSummary(place.card.weather, locale) : copy.chapter}{place.card.weather?.moons.map(moon => ` · ${moon.name}: ${copy[moon.phase]}`).join('')}</summary>
      <div className="pt-4"><WorldPresence card={place.card} title={place.name} /></div>
    </details>)}
    {result.status === 'pending' && <div><p>{copy.pending}</p>{retry}</div>}
  </div>;
}
