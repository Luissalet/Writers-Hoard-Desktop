import type { CodexTemplate, ReferenceFieldDefinition } from './templates';
import { foldAlias } from '@/services/codexReference/aliases';
import { validateTemplatePresentation } from './templateTypes';

/** Includes self. Malformed imported cycles/missing parents terminate safely. */
export function templateLineage(template: CodexTemplate, templates: readonly CodexTemplate[]): CodexTemplate[] {
  const byId = new Map(templates.map(item => [item.id, item])); byId.set(template.id, template);
  const lineage: CodexTemplate[] = [], visited = new Set<string>(); let current: CodexTemplate | undefined = template;
  while (current && !visited.has(current.id)) { visited.add(current.id); lineage.push(current); current = current.parentTemplateId ? byId.get(current.parentTemplateId) : undefined; }
  return lineage.reverse();
}
export function templateIsWithin(id: string | undefined, parentId: string, templates: readonly CodexTemplate[]): boolean {
  if (!id) return false; const template = templates.find(item => item.id === id);
  return id === parentId || Boolean(template && templateLineage(template, templates).some(item => item.id === parentId));
}
export function templatePath(template: CodexTemplate, templates: readonly CodexTemplate[]): string { return templateLineage(template, templates).map(item => item.name).join(' / '); }
export function hierarchyOrder(templates: readonly CodexTemplate[]): CodexTemplate[] {
  const result: CodexTemplate[] = [], visited = new Set<string>(), byId = new Map(templates.map(item => [item.id, item])), children = new Map<string, CodexTemplate[]>();
  for (const item of templates) if (item.parentTemplateId) children.set(item.parentTemplateId, [...children.get(item.parentTemplateId) ?? [], item]);
  const append = (item: CodexTemplate) => { const stack = [item]; while (stack.length) { const next = stack.pop()!; if (visited.has(next.id)) continue; visited.add(next.id); result.push(next); stack.push(...(children.get(next.id) ?? []).slice().reverse()); } };
  for (const item of templates) if (!item.parentTemplateId || !byId.has(item.parentTemplateId)) append(item);
  for (const item of templates) append(item);
  return result;
}
export type TemplatePresentation = Pick<CodexTemplate,'icon'|'color'|'imageLayout'|'hiddenFromPickers'>;
/** Independent inheritance; explicit false remains a visibility override. */
export function effectiveTemplatePresentation(template:CodexTemplate|undefined,templates:readonly CodexTemplate[]):TemplatePresentation {
  const result:TemplatePresentation={icon:undefined,color:undefined,imageLayout:undefined,hiddenFromPickers:undefined};if(!template)return result;
  for(const item of templateLineage(template,templates)){
    if(item.category!==template.category)continue;
    for(const key of ['icon','color','imageLayout','hiddenFromPickers']as const){
      if(item[key]===undefined)continue;
      try{validateTemplatePresentation({[key]:item[key]});Object.assign(result,{[key]:item[key]});}catch{/* Malformed imported values never become CSS, component names or visibility rules. */}
    }
  }
  return result;
}
export function selectableCodexTemplates(templates:readonly CodexTemplate[],selectedId?:string):CodexTemplate[]{
  return hierarchyOrder(templates).filter(template=>template.id===selectedId||!effectiveTemplatePresentation(template,templates).hiddenFromPickers);
}
/** One field identity per folded key; a child may override defaults or field kind. */
export function effectiveCodexTemplate(template: CodexTemplate, templates: readonly CodexTemplate[]): CodexTemplate {
  const fields = new Map<string, [string, string]>(), references = new Map<string, ReferenceFieldDefinition>(); let content = '';
  for (const item of templateLineage(template, templates)) {
    if (item.category !== template.category) continue;
    for (const [key, value] of Object.entries(item.fields)) { const canonical = foldAlias(key); references.delete(canonical); fields.set(canonical, [key, value]); }
    for (const definition of item.referenceFieldDefinitions ?? []) { const canonical = foldAlias(definition.key); fields.delete(canonical); references.set(canonical, { ...definition }); }
    if (item.contentMode === 'replace' || item.contentMode !== 'inherit' && item.content.trim()) content = item.content;
  }
  return { ...template, ...effectiveTemplatePresentation(template,templates),fields: Object.fromEntries(fields.values()), referenceFieldDefinitions: [...references.values()], content };
}
export function validateTemplateHierarchy(draft: CodexTemplate, templates: readonly CodexTemplate[]): void {
  validateTemplatePresentation(draft);
  const byId = new Map(templates.map(item => [item.id, item])); byId.set(draft.id, draft);
  const visited = new Set<string>([draft.id]); let parentId = draft.parentTemplateId;
  while (parentId) { if (visited.has(parentId)) throw new Error('template_parent_cycle'); visited.add(parentId); const parent = byId.get(parentId); if (!parent) throw new Error('template_parent_missing'); if (parent.category !== draft.category) throw new Error('template_parent_category'); parentId = parent.parentTemplateId; }
  if (templates.some(item => item.parentTemplateId === draft.id && item.category !== draft.category)) throw new Error('template_child_category');
  if (templates.some(item => item.referenceFieldDefinitions?.some(definition => definition.targetTemplateId === draft.id && definition.targetType && definition.targetType !== draft.category))) throw new Error('template_reference_category');
  if (draft.contentMode !== undefined && !['inherit', 'replace'].includes(draft.contentMode)) throw new Error('template_content_mode');
  for (const definition of draft.referenceFieldDefinitions ?? []) {
    if (!definition.targetTemplateId) continue;
    const target = byId.get(definition.targetTemplateId); if (!target || definition.targetType && target.category !== definition.targetType) throw new Error('template_reference_target');
  }
}
