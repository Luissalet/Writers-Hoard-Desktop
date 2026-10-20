import type { CodexEntryType } from '@/types';
export interface ReferenceFieldDefinition { key: string; label: string; targetType?: CodexEntryType; targetTemplateId?: string }
export interface CodexTemplate {
  id: string;
  name: string;
  category: CodexEntryType;
  parentTemplateId?: string;
  /** An absent mode inherits an empty child body; replace can explicitly be blank. */
  contentMode?: 'inherit' | 'replace';
  /** Absent presentation properties inherit independently from the parent. */
  icon?: string;
  color?: string;
  /** Absent layouts retain the legacy square image when no ancestor sets one. */
  imageLayout?: 'portrait' | 'landscape' | 'none';
  hiddenFromPickers?: boolean;
  fields: Record<string, string>;
  content: string;
  referenceFieldDefinitions?: ReferenceFieldDefinition[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export function validateTemplatePresentation(template: Pick<CodexTemplate,'icon'|'color'|'imageLayout'|'hiddenFromPickers'>): void {
  if(template.icon!==undefined&&(typeof template.icon!=='string'||!/^[A-Z][A-Za-z0-9]{0,79}$/.test(template.icon)))throw new Error('template_icon_invalid');
  if(template.color!==undefined&&(typeof template.color!=='string'||!/^#[0-9a-f]{6}$/i.test(template.color)))throw new Error('template_color_invalid');
  if(template.imageLayout!==undefined&&!['portrait','landscape','none'].includes(template.imageLayout))throw new Error('template_image_layout_invalid');
  if(template.hiddenFromPickers!==undefined&&typeof template.hiddenFromPickers!=='boolean')throw new Error('template_visibility_invalid');
}
