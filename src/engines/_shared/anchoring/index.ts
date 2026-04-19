// Anchoring barrel — re-exports for the rest of the app.

export type { AnchorAdapter, InlineCreateFormProps } from './types';
export {
  registerAnchorAdapter,
  getAnchorAdapter,
  getAllAnchorAdapters,
  getAnnotatableEngineIds,
} from './registry';
export { htmlToText } from './htmlToText';
export {
  resolveTextRangeAnchor,
  captureContext,
  type ResolvedAnchor,
  type AnchorResolution,
} from './anchorResolver';
export {
  installNavigator,
  navigateTo,
  getCurrentProjectIdFromUrl,
} from './navigation';
