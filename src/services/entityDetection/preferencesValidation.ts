import type { EntityDetectionPreferences } from './types';
/** Pure project archive validator, safe to import without the database. */
export function validEntityDetectionPreferences(value: unknown): value is EntityDetectionPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isSafeInteger(record.revision) && Number(record.revision) >= 0 && ['detectNewEntities', 'autoLinkMentions', 'animateNewLinks'].every(key => typeof record[key] === 'boolean') && Object.keys(record).every(key => ['revision', 'detectNewEntities', 'autoLinkMentions', 'animateNewLinks'].includes(key));
}
export function validateEntityDetectionPreferences(value: unknown): void { if (value !== undefined && !validEntityDetectionPreferences(value)) throw Error('entity_preferences_invalid'); }
