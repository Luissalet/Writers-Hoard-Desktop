import { createPath, parsePath, type To } from 'react-router-dom';

export interface WorkspaceRoute { pathname: string; search: string; hash: string }
export function workspaceRoute(to: To, current?: WorkspaceRoute): WorkspaceRoute {
  const parsed = typeof to === 'string' ? parsePath(to) : to;
  return { pathname: parsed.pathname ?? current?.pathname ?? '/', search: parsed.search ?? '', hash: parsed.hash ?? '' };
}
export function workspaceRouteKey(route: WorkspaceRoute) { return createPath(route); }
export function paneEngineId(route: WorkspaceRoute, projectId: string, enabledIds: readonly string[]): string | undefined {
  const match = /^\/project\/([^/]+)\/([^/]+)\/?$/.exec(route.pathname);
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]) === projectId && enabledIds.includes(decodeURIComponent(match[2])) ? decodeURIComponent(match[2]) : undefined; } catch { return undefined; }
}
