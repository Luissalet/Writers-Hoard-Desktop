// ============================================
// Storyboard Engine — React Hooks
// ============================================

import { makeEntityHook } from '@/engines/_shared';
import * as ops from './operations';
import type { Storyboard, StoryboardPanel, StoryboardConnector } from './types';

export const useStoryboards = makeEntityHook<Storyboard>({
  fetchFn: ops.getStoryboards,
  createFn: ops.createStoryboard,
  updateFn: ops.updateStoryboard,
  deleteFn: ops.deleteStoryboard,
});

export const useStoryboardPanels = makeEntityHook<StoryboardPanel>({
  fetchFn: ops.getPanels,
  createFn: ops.createPanel,
  updateFn: ops.updatePanel,
  deleteFn: ops.deletePanel,
  reorderFn: ops.reorderPanels,
});

export const useStoryboardConnectors = makeEntityHook<StoryboardConnector>({
  fetchFn: ops.getConnectors,
  createFn: ops.createConnector,
  updateFn: ops.updateConnector,
  deleteFn: ops.deleteConnector,
});
