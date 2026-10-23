// What the players would see of the Codex: only revealed cards, with what the
// wiki already keeps out (hidden blocks, spoilers, private types, the project's
// excluded fields) kept out here too. Pure helpers; the Codex list renders them.
import type { CodexEntry, Project } from '@/types';
import { privateTemplateIds } from './templateHierarchy';
import { isRevealed } from './revealModel';

/**
 * What the wiki policy keeps out of anything players read: the union of the project's own wiki options and the
 * saved wiki profiles meant for players (the ones that publish only revealed cards). With a profile id the union is
 * the project options plus that one profile. Over-hiding is the safe side for a spoiler view.
 */
export function playerWikiRules(project: Pick<Project, 'wikiOptions' | 'wikiProfiles'> | undefined, profileId?: string): { excludedFields: Set<string>; excludedEntryIds: Set<string> } {
  const sources = [project?.wikiOptions, ...(project?.wikiProfiles ?? []).filter(profile => profileId ? profile.id === profileId : profile.options?.onlyRevealed).map(profile => profile.options)];
  const excludedFields = new Set<string>(), excludedEntryIds = new Set<string>();
  for (const source of sources) {
    for (const name of source?.excludedFields ?? []) excludedFields.add(name);
    for (const id of source?.excludedEntryIds ?? []) excludedEntryIds.add(id);
  }
  return { excludedFields, excludedEntryIds };
}

/** Revealed cards of a type that is not private, minus the cards the wiki policy excludes. */
export function playerVisibleEntries<T extends CodexEntry>(entries: readonly T[], templates: Project['codexTemplates'], project?: Pick<Project, 'wikiOptions' | 'wikiProfiles'>, profileId?: string): T[] {
  const privateTypes = privateTemplateIds(templates ?? []);
  const { excludedEntryIds } = playerWikiRules(project, profileId);
  return entries.filter(entry => isRevealed(entry) && !excludedEntryIds.has(entry.id) && !(entry.templateId && privateTypes.has(entry.templateId)));
}

/** Field names the wiki policy of the project (and the player-facing profiles) keeps out of anything published. */
export const playerHiddenFields = (project: Pick<Project, 'wikiOptions' | 'wikiProfiles'> | undefined, profileId?: string): Set<string> => playerWikiRules(project, profileId).excludedFields;

/**
 * The body as players read it: wiki-hidden blocks removed, spoilers covered, Codex blocks of cards that are not
 * revealed (or are excluded) removed, and tool / source blocks removed (their captions carry labels).
 */
export function playerSafeHtml(html: string, allowedEntryIds?: ReadonlySet<string>): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('[data-wh-wiki-hidden="true"]').forEach(node => node.remove());
  template.content.querySelectorAll('[data-wh-codex-block="true"]').forEach(node => { if (!allowedEntryIds?.has(node.getAttribute('data-entry-id') ?? '')) node.remove(); });
  template.content.querySelectorAll('[data-wh-tool-block="true"],[data-wh-source-block="true"]').forEach(node => node.remove());
  template.content.querySelectorAll('[data-wh-wiki-spoiler="true"]').forEach(node => { node.replaceChildren(document.createTextNode('▮▮▮')); });
  return template.innerHTML;
}
