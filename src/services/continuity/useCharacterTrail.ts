import { useMemo } from 'react';
import type { TrailPoint } from '@/engines/worldgen/cartography/readerTrail';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { useContinuityReport } from './useContinuityReport';

export interface CharacterTrail { name: string; points: TrailPoint[]; impossible: number; tight: number }

/**
 * A character's trail on one world for the map: their appearances in story
 * order, each point flagged when the leg that reaches it is impossible or tight
 * (the same verdicts as the chapter panel). Null while there is nothing to draw.
 */
export function useCharacterTrail(projectId: string, worldId: string, characterId: string | null): CharacterTrail | null {
  const scope = useWorldEraScope(projectId);
  const { report } = useContinuityReport(projectId, { eraId: scope.eraId, characterId: characterId ?? undefined, disabled: !characterId });
  return useMemo(() => {
    if (!characterId || !report) return null;
    const appearances = (report.appearances[characterId] ?? []).filter((a) => a.worldId === worldId);
    if (!appearances.length) return null;
    const legs = new Map(report.legs.filter((l) => l.characterId === characterId && l.intentional === undefined).map((l) => [l.to.id, l.verdict]));
    const points: TrailPoint[] = appearances.map((a) => ({
      x: a.x - 0.5, y: a.y - 0.5, chapter: a.chapter,
      ...(legs.get(a.id) === 'impossible' ? { impossible: true } : legs.get(a.id) === 'tight' ? { tight: true } : {}),
    }));
    return {
      name: report.titles[characterId] ?? characterId, points,
      impossible: points.filter((p) => p.impossible).length, tight: points.filter((p) => p.tight).length,
    };
  }, [report, characterId, worldId]);
}
