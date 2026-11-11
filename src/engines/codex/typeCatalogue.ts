import {propertyDefinitions} from './properties';
import {effectiveCodexTemplate,hierarchyOrder,templatePath} from './templateHierarchy';
import type {CodexPropertyDefinition,CodexTemplate,ReferenceFieldDefinition} from './templateTypes';

/** Effective schema and display of a reusable Codex type. No card bodies or defaults. */
export interface CodexTypeCatalogueRow {
 readonly id:string;
 readonly name:string;
 readonly category:CodexTemplate['category'];
 readonly parentId?:string;
 readonly path:string;
 readonly icon?:string;
 readonly color?:string;
 readonly imageLayout?:CodexTemplate['imageLayout'];
 readonly hiddenFromPickers:boolean;
 readonly privateType:boolean;
 readonly properties:readonly Readonly<CodexPropertyDefinition>[];
 readonly references:readonly Readonly<ReferenceFieldDefinition>[];
}

const stringMap=(values:Record<string,string>)=>Object.fromEntries(Object.entries(values).filter(([,value])=>typeof value==='string'));

function projectProperty(definition:CodexPropertyDefinition):CodexPropertyDefinition{
 const {id,key,label,kind,presets,optionColors,formula,resultType,formulaBindings,required,description}=definition;
 return {
  id,key,label,kind,
  ...(Array.isArray(presets)?{presets:presets.filter(value=>typeof value==='string')}:{}),
  ...(optionColors&&typeof optionColors==='object'?{optionColors:stringMap(optionColors)}:{}),
  ...(typeof formula==='string'?{formula}:{}),
  ...(typeof resultType==='string'?{resultType}:{}),
  ...(formulaBindings&&typeof formulaBindings==='object'?{formulaBindings:stringMap(formulaBindings)}:{}),
  ...(typeof required==='boolean'?{required}:{}),
  ...(typeof description==='string'?{description}:{}),
 };
}

function projectReference({key,label,targetType,targetTemplateId}:ReferenceFieldDefinition):ReferenceFieldDefinition{
 return {key,label,...(typeof targetType==='string'?{targetType}:{}),...(typeof targetTemplateId==='string'?{targetTemplateId}:{})};
}

export function projectCodexTypeCatalogue(templates:readonly CodexTemplate[]):CodexTypeCatalogueRow[]{
 return hierarchyOrder(templates).map(template=>{
  const resolved=effectiveCodexTemplate(template,templates);
  return {
   id:template.id,name:template.name,category:template.category,
   ...(template.parentTemplateId?{parentId:template.parentTemplateId}:{}),path:templatePath(template,templates),
   ...(resolved.icon?{icon:resolved.icon}:{}),...(resolved.color?{color:resolved.color}:{}),
   ...(resolved.imageLayout?{imageLayout:resolved.imageLayout}:{}),
   hiddenFromPickers:resolved.hiddenFromPickers===true,privateType:resolved.privateType===true,
   properties:propertyDefinitions(resolved).map(projectProperty),references:(resolved.referenceFieldDefinitions??[]).map(projectReference),
  };
 });
}
