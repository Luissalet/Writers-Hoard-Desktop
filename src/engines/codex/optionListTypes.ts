import {foldAlias} from '@/services/codexReference/aliases';
export const CODEX_OPTION_LISTS_KEY='codexOptionLists' as const;
export interface CodexOptionList {id:string;name:string;options:string[];optionColors?:Record<string,string>;revision:number;createdAt:number;updatedAt:number}
/** Shared project defaults. Literal values/colors copy unchanged; property IDs never enter this library. */
export function validateCodexOptionLists(value:unknown):asserts value is CodexOptionList[]|undefined{
 if(value===undefined)return;if(!Array.isArray(value))throw Error('codex_option_lists_invalid');const ids=new Set<string>(),names=new Set<string>();
 for(const list of value){if(!list||typeof list!=='object'||typeof list.id!=='string'||!list.id||typeof list.name!=='string'||!list.name.trim()||ids.has(list.id)||names.has(foldAlias(list.name.trim()))||!Array.isArray(list.options)||list.options.some((option:unknown)=>typeof option!=='string'||!option.trim())||new Set(list.options).size!==list.options.length||!Number.isSafeInteger(list.revision)||list.revision<0||!Number.isFinite(list.createdAt)||!Number.isFinite(list.updatedAt))throw Error('codex_option_list_invalid');ids.add(list.id);names.add(foldAlias(list.name.trim()));
 if(list.optionColors!==undefined){if(!list.optionColors||typeof list.optionColors!=='object'||Array.isArray(list.optionColors)||![Object.prototype,null].includes(Object.getPrototypeOf(list.optionColors)))throw Error('codex_option_list_colors_invalid');for(const [option,color]of Object.entries(list.optionColors))if(!option.trim()||typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color))throw Error('codex_option_list_colors_invalid');}
 }
}
