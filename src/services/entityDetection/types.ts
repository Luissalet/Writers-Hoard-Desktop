export interface EntityDetectionPreferences {
  revision: number;
  detectNewEntities: boolean;
  autoLinkMentions: boolean;
  animateNewLinks: boolean;
}
export const DEFAULT_ENTITY_PREFERENCES: EntityDetectionPreferences = { revision: 0, detectNewEntities: false, autoLinkMentions: true, animateNewLinks: false };
export interface EntitySpan { from: number; to: number; text: string; label: 'PER' | 'LOC' | 'ORG'; score: number }
export interface EntityDetectionStatus { state: 'missing' | 'preparing' | 'ready' | 'error'; model: string; progress?: number; detail?: string }
export interface EntityDetectionAPI {
  status(): Promise<EntityDetectionStatus>;
  prepare(): Promise<EntityDetectionStatus>;
  detect(text: string): Promise<EntitySpan[]>;
}
