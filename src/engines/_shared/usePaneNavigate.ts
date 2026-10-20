import { useCallback } from 'react';
import { useEnginePane } from './EnginePaneContext';
import { navigateTo } from './anchoring/navigation';
import type { AnchorAdapter } from './anchoring/types';

export function usePaneNavigate() { return useEnginePane()?.navigate ?? navigateTo; }
export function usePaneAnchorNavigate() {
  const navigate = usePaneNavigate();
  return useCallback((adapter: AnchorAdapter, entityId: string, projectId?: string) => adapter.navigateToEntity(entityId, projectId, navigate), [navigate]);
}
