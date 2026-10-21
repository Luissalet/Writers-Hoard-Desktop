import type { Project } from '@/types';
import type { EraDocument,EraDocumentKind } from '@/services/worldEras/types';
import { effectiveCodexTemplate } from '@/engines/codex/templateHierarchy';
import { propertyDefinitions } from '@/engines/codex/properties';
/** Keep dependency definitions separate from the immutable authored preimage/hash. */
export function historyCodexDefinitions(kind:EraDocumentKind,document:EraDocument,project:Project){
 if(kind!=='codex'||document.root.propertyDefinitions)return undefined;
 const template=project.codexTemplates?.find(row=>row.id===document.root.templateId);
 return template?structuredClone(propertyDefinitions(effectiveCodexTemplate(template,project.codexTemplates??[]))):undefined;
}
