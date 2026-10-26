export interface TimelineViewportScope { projectId: string; eraId?: string }
export interface TimelineViewportState {
  available: boolean; reason?: 'not-mounted' | 'not-visible'; mode: 'manual' | 'fit'; zoom: number;
  viewportWidth: number; canvasWidth: number; canFit: boolean;
}
interface Host extends TimelineViewportScope { hostId: string; instanceId: string; get: () => TimelineViewportState; fit: () => TimelineViewportState }
const hosts = new Set<Host>();
const matches = (host: Host, scope: TimelineViewportScope) => host.projectId === scope.projectId && (host.eraId ?? null) === (scope.eraId ?? null);
export function timelineFitScale(width: number, canvasWidth: number): number | undefined {
  return Number.isFinite(width) && Number.isFinite(canvasWidth) && width > 2 && canvasWidth > 0 ? Math.min(1, (width - 2) / canvasWidth) : undefined;
}
/** Ephemeral callbacks only: no viewport survives its actual mounted host. */
export function registerTimelineViewport(scope: TimelineViewportScope, instanceId: string, get: Host['get'], fit: Host['fit']): () => void {
  const host: Host = { ...scope, instanceId, hostId: crypto.randomUUID(), get, fit }; hosts.add(host);
  return () => { hosts.delete(host); };
}
export function timelineViewportTargets(scope: TimelineViewportScope) {
  return [...hosts].filter(host => matches(host, scope)).flatMap(host => {
    const state = host.get(); return state.available ? [{ hostId: host.hostId, instanceId: host.instanceId, ...state }] : [];
  });
}
export function fitTimelineViewport(scope: TimelineViewportScope, hostId: string): TimelineViewportState {
  const host = [...hosts].find(row => matches(row, scope) && row.hostId === hostId);
  return host?.fit() ?? { available: false, reason: 'not-mounted', mode: 'manual', zoom: 1, viewportWidth: 0, canvasWidth: 0, canFit: false };
}
