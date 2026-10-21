import { createPath, parsePath, type To } from 'react-router-dom';

export interface WorkspaceRoute { pathname: string; search: string; hash: string }
export function workspaceRoute(to: To, current?: WorkspaceRoute): WorkspaceRoute {
  const parsed = typeof to === 'string' ? parsePath(to) : to;
  const search = new URLSearchParams(parsed.search ?? '');
  const inherited = new URLSearchParams(current?.search ?? '').get('era');
  const sourceProject = current?.pathname.match(/^\/project\/([^/]+)\//)?.[1], targetProject = parsed.pathname?.match(/^\/project\/([^/]+)\//)?.[1];
  if (!search.has('era') && inherited !== null && (!parsed.pathname || sourceProject && sourceProject === targetProject)) search.set('era', inherited);
  return { pathname: parsed.pathname ?? current?.pathname ?? '/', search: search.size ? `?${search}` : '', hash: parsed.hash ?? '' };
}
export function workspaceRouteKey(route: WorkspaceRoute) { return createPath(route); }
export function paneEngineId(route: WorkspaceRoute, projectId: string, enabledIds: readonly string[]): string | undefined {
  const match = /^\/project\/([^/]+)\/([^/]+)\/?$/.exec(route.pathname);
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]) === projectId && enabledIds.includes(decodeURIComponent(match[2])) ? decodeURIComponent(match[2]) : undefined; } catch { return undefined; }
}

export function workspaceEra(route: WorkspaceRoute): string | undefined { return new URLSearchParams(route.search).get('era') || undefined; }
export function routeInEra(route: WorkspaceRoute, eraId?: string): WorkspaceRoute { const search = new URLSearchParams(route.search); search.set('era', eraId ?? ''); return { ...route, search: `?${search}` }; }
