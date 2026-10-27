import { absoluteToLocalCell, localToAbsoluteCell, type DomainBounds } from './core/worldDomain';
import type { WorldWaypoint } from './types';

export interface WaypointDomain { topology: string; bounds: DomainBounds }

/** Persist source cells; normalized coordinates describe the current view only. */
export function waypointCellFromPosition(domain: WaypointDomain, u: number, v: number) {
  return domain.topology === 'finite'
    ? localToAbsoluteCell({ domain }, u * domain.bounds.width, v * domain.bounds.height)
    : undefined;
}

export function waypointForDomain<T extends Pick<WorldWaypoint, 'cell' | 'u' | 'v'>>(waypoint: T, domain: WaypointDomain): T {
  if (domain.topology !== 'finite' || !waypoint.cell) return waypoint;
  const position = absoluteToLocalCell({ domain }, waypoint.cell);
  return { ...waypoint, u: position.x / domain.bounds.width, v: position.y / domain.bounds.height };
}
