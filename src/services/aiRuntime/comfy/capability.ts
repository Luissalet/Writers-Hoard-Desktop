// ============================================================================
// ComfyUI — per-template capability check
// ============================================================================
//
// Runs once against /object_info at connect time. A template whose node
// classes are not all installed is greyed out with the name of the pack that
// provides them; it is never submitted, because a prompt ComfyUI rejects on
// validation is worse than a feature the user can see is unavailable.

import { hasClass, type ComfyObjectInfo } from './objectInfo';
import { joinNames, packsForClasses } from './nodePacks';
import type { ComfyTemplate } from './types';

export interface TemplateAvailability {
  templateId: string;
  ok: boolean;
  /** Node classes this ComfyUI does not have. */
  missing: string[];
  /** Packs that would provide them, when they come from a pack. */
  packs: Array<{ pack: string; url: string }>;
  /** A sentence to show the user. Empty when the template is available. */
  message: string;
}

export function checkTemplate(template: ComfyTemplate, info: ComfyObjectInfo): TemplateAvailability {
  const missing = template.requires.filter((className) => !hasClass(info, className));
  if (missing.length === 0) {
    return { templateId: template.id, ok: true, missing: [], packs: [], message: '' };
  }
  const packs = packsForClasses(missing);
  const fromPacks = new Set(packs.flatMap((pack) => [pack.pack]));
  const core = missing.filter((className) => packsForClasses([className]).length === 0);
  const parts: string[] = [];
  if (packs.length) parts.push(`${template.label} needs ${joinNames([...fromPacks])}.`);
  if (core.length) {
    // A core class this ComfyUI lacks means the install is older than the
    // template, not that a pack is missing — saying "install a pack" there
    // would send the user looking for something that does not exist.
    parts.push(
      `${template.label} uses ${joinNames(core)}, which this ComfyUI does not provide. Update ComfyUI.`,
    );
  }
  return { templateId: template.id, ok: false, missing, packs, message: parts.join(' ') };
}

export function checkTemplates(templates: readonly ComfyTemplate[], info: ComfyObjectInfo): TemplateAvailability[] {
  return templates.map((template) => checkTemplate(template, info));
}
