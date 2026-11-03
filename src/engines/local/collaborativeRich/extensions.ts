import {Extension,getExtensionField,type AnyExtension,type JSONContent} from '@tiptap/core';
import type {EditorState} from '@tiptap/pm/state';
import type {RichDocument} from '../convergence/richTypes';

const reserved=new Set(['doc','paragraph','text','bold','italic','underline','strike','code','writerRichAdmission','clipboardTextSerializer','commands','delete','drop','editable','focusEvents','keymap','paste','tabindex','textDirection','history','undoRedo','collaboration','collaborationCursor','collaborationCaret']);
const schemaHooks=['addGlobalAttributes','extendNodeSchema','extendMarkSchema'] as const;
/** Compatibility contract, not an inspection sandbox for arbitrary author code. */
export function prepareRichExtraExtensions(input:readonly AnyExtension[]|undefined,links=false){
 const members=[...(input??[])],names=new Set([...reserved,...(links?['link']:[])]),extensions:AnyExtension[]=[];
 let error='';
 const visit=(extension:AnyExtension,ancestors:Set<AnyExtension>)=>{
  if(!extension||extension.type!=='extension'||names.has(extension.name))throw Error('local_tool_rich_editor_extension_incompatible');
  if(ancestors.has(extension))throw Error('local_tool_rich_editor_extension_cycle');
  for(const key of schemaHooks)if(getExtensionField(extension,key)!==undefined)throw Error('local_tool_rich_editor_extension_schema');
  names.add(extension.name);
  const add=getExtensionField(extension,'addExtensions',{name:extension.name,options:extension.options,storage:extension.storage});
  // Expand once. Inherit hooks without copying them: hooks that call this.parent()
  // retain their original chain and run once. Only addExtensions is neutralized.
  const prepared=Extension.create({name:extension.name,addExtensions:()=>[]});prepared.parent=extension;extensions.push(prepared);
  if(add){const next=new Set(ancestors);next.add(extension);for(const child of add())visit(child,next);}
 };
 try{for(const extension of members)visit(extension,new Set());}catch(reason){error=reason instanceof Error?reason.message:String(reason);extensions.length=0;}
 return{members,extensions,error,matches:(next:readonly AnyExtension[]|undefined)=>{const supplied=next??[];return supplied.length===members.length&&supplied.every((extension,i)=>extension===members[i]);}};
}
/** Known conflicting histories fail visibly. Renamed opaque history remains outside the contract. */
export function richExtensionPluginError(state:EditorState){return state.plugins.some(plugin=>{const key:unknown=Reflect.get(plugin,'key');return typeof key==='string'&&/^(?:history|y-sync|y-undo|y-cursor)\$(?:\d+)?$/.test(key);})?'local_tool_rich_editor_extension_history':'';}
/** Pure initial PM content: lifecycle edits start on the real Source identities, never a placeholder. */
export function richEditorInitialContent(document:RichDocument):JSONContent{return{type:'doc',content:document.content.length?document.content.map(paragraph=>({type:'paragraph',attrs:{id:paragraph.id},content:paragraph.content.map(part=>({type:'text',text:part.text,...(part.marks?.length?{marks:part.marks.map(mark=>(mark.type==='link'?{type:mark.type,attrs:{...mark.attrs}}:{type:mark.type}))}:{})}))})):[{type:'paragraph',attrs:{id:null}}]};}
