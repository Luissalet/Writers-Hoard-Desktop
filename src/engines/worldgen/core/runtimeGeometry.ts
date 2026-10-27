import type { WorldData, WorldParams } from './types';
import { sourceLatitude } from './worldDomain';

/** Derived finite materialization only; params remain the immutable carrier. */
export interface RuntimeGeometry { width: number; height: number; originX: number; originY: number }

export function runtimeGeometry(world: Pick<WorldData, 'width' | 'height' | 'domain'>): RuntimeGeometry | undefined {
  if (world.domain?.topology !== 'finite') return undefined;
  return { width: world.width, height: world.height, originX: world.domain.bounds.x, originY: world.domain.bounds.y };
}

export function runtimeLatitude(params: WorldParams, geometry: RuntimeGeometry, y: number): number {
  return sourceLatitude(params, geometry.originY + y);
}

export function runtimeU(params: WorldParams, geometry: RuntimeGeometry, x: number): number {
  return (geometry.originX + x) / params.width;
}

export function runtimeV(params: WorldParams, geometry: RuntimeGeometry, y: number): number {
  return (geometry.originY + y) / (params.width / 2);
}
