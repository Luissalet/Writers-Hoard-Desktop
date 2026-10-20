import { useMemo, type ReactNode } from 'react';
import { NavigationType, UNSAFE_LocationContext, UNSAFE_NavigationContext, UNSAFE_RouteContext, createPath, type Navigator } from 'react-router-dom';
import { workspaceRoute, type WorkspaceRoute } from './routes';

/** A secondary pane is a navigation surface inside the existing router. These
 * public context exports avoid nesting a second Router (which React Router
 * rejects), while giving engine hooks a local location, navigator and params. */
export default function PaneRouter({ projectId, engineId, route, onNavigate, onBack, children }: { projectId: string; engineId: string; route: WorkspaceRoute; onNavigate: (route: WorkspaceRoute, replace?: boolean) => void; onBack: (delta: number) => void; children: ReactNode }) {
  const navigator = useMemo<Navigator>(() => ({
    createHref: to => createPath(workspaceRoute(to, route)),
    go: onBack,
    push: to => onNavigate(workspaceRoute(to, route)),
    replace: to => onNavigate(workspaceRoute(to, route), true),
  }), [onBack, onNavigate, route]);
  const location = useMemo(() => ({ ...route, key: createPath(route), state: null }), [route]);
  const routes = useMemo(() => ({ outlet: null, isDataRoute: false, matches: [{ params: { id: projectId, tab: engineId }, pathname: route.pathname, pathnameBase: route.pathname, route: { id: 'secondary-engine', path: '/project/:id/:tab' } }] }), [engineId, projectId, route.pathname]);
  return <UNSAFE_NavigationContext.Provider value={{ basename: '/', navigator, static: false, useTransitions: false, future: {} }}><UNSAFE_LocationContext.Provider value={{ location, navigationType: NavigationType.Pop }}><UNSAFE_RouteContext.Provider value={routes}>{children}</UNSAFE_RouteContext.Provider></UNSAFE_LocationContext.Provider></UNSAFE_NavigationContext.Provider>;
}
