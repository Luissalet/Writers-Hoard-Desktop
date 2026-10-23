// Freezing a card from its type: the card keeps what it shows now — inherited
// defaults and calculated values become its own plain values, the property
// kinds stay — and later edits of the type no longer reach it. Choosing a type
// again in the card form links it back.
import type { CodexEntry } from '@/types';
import { projectCodexEntry, propertyDefinitions } from './properties';
import { effectiveCodexTemplate } from './templateHierarchy';
import type { CodexPropertyDefinition, CodexTemplate } from './templateTypes';

export function freezeCodexEntry(entry: CodexEntry, templates: readonly CodexTemplate[]): Pick<CodexEntry, 'fields' | 'propertyDefinitions' | 'templateId'> {
  const projection = projectCodexEntry(entry, templates);
  const template = templates.find(item => item.id === entry.templateId);
  const effective = template ? effectiveCodexTemplate(template, templates) : undefined;
  const definitions = effective ? propertyDefinitions(effective) : entry.propertyDefinitions ?? [];
  // Plain fields of the type get a stand-in `legacy:` definition when read; a
  // frozen card keeps them as the plain fields they are.
  const frozen: CodexPropertyDefinition[] = definitions.filter(definition => !definition.id.startsWith('legacy:')).map(definition => {
    const copy: CodexPropertyDefinition = { ...definition };
    // A calculation becomes the value it gave; the property keeps its kind.
    delete copy.formula; delete copy.formulaBindings; delete copy.resultType;
    return copy;
  });
  // The type's defaults fill what the card left empty; what the card shows wins.
  const fields: Record<string, string> = { ...(effective?.fields ?? {}), ...Object.fromEntries(Object.entries(entry.fields).filter(([, value]) => value !== '')) };
  for (const [key, value] of Object.entries(projection.fields)) if (value !== '' || !(key in fields)) fields[key] = value;
  return { fields, propertyDefinitions: frozen.length ? frozen : undefined, templateId: undefined };
}
