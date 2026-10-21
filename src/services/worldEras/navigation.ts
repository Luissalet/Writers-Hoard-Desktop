import { useCallback } from 'react';
import { createPath, parsePath, useNavigate, type NavigateFunction, type NavigateOptions, type To } from 'react-router-dom';
import { useWorldEraScope } from './hooks';
/** Ordinary engine links retain this pane's era; explicit era= selects Shared base. */
export function useEraNavigate(): NavigateFunction {
  const navigate = useNavigate(), scope = useWorldEraScope();
  return useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') return navigate(to);
    const route = typeof to === 'string' ? parsePath(to) : to;
    if (scope.eraId && (!route.pathname || route.pathname.startsWith(`/project/${encodeURIComponent(scope.projectId)}/`))) {
      const query = new URLSearchParams(route.search ?? ''); if (!query.has('era')) query.set('era', scope.eraId);
      return navigate(createPath({ ...route, search: `?${query}` }), options);
    }
    return navigate(to, options);
  }, [navigate, scope]) as NavigateFunction;
}
