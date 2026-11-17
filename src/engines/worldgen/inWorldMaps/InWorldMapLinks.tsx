import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from '@/i18n/useTranslation';
import { useEraNavigate } from '@/services/worldEras/navigation';
import { listEraRows } from '@/services/worldEras/store';
import type { WorldEraScope } from '@/services/worldEras/types';
import type { GeneratedWorld } from '../types';
import { inWorldMapCopy } from './copy';

export default function InWorldMapLinks({ scope, entryId }: { scope: WorldEraScope; entryId: string }) {
  const navigate = useEraNavigate();
  const { locale } = useTranslation();
  const matches = useLiveQuery(async () => {
    const worlds = await listEraRows<GeneratedWorld>(scope, 'generatedWorlds');
    return worlds.flatMap(world => (world.inWorldMaps ?? []).filter(map => map.entryId === entryId)
      .map(map => ({ worldId: world.id, worldTitle: world.title, id: map.id, title: map.title })));
  }, [entryId, scope.projectId, scope.eraId]);
  if (!matches?.length) return null;
  return <section className="space-y-1.5" data-testid="codex-in-world-maps">
    <h3 className="text-sm font-semibold text-text-primary">{inWorldMapCopy[locale].title}</h3>
    <ul className="space-y-1">
      {matches.map(map => <li key={map.worldId + ':' + map.id}>
        <button type="button" className="text-left text-sm text-accent-gold underline underline-offset-2" onClick={() => {
          navigate('/project/' + encodeURIComponent(scope.projectId) + '/worldgen?' + new URLSearchParams({ world: map.worldId, inWorldMap: map.id }));
        }}>{map.title} <span className="text-text-muted">· {map.worldTitle}</span></button>
      </li>)}
    </ul>
  </section>;
}
