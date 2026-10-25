import { buildWorldBible, exportWorldBible, loadBibleData, type BibleSelection } from '@/services/worldBible';
import { BridgeError, resolveProjectId, type ToolArgs } from './shared';
function selection(args: ToolArgs): BibleSelection {
  if (args.locale !== undefined && args.locale !== 'es' && args.locale !== 'en') throw new BridgeError('bad-args', 'Invalid locale');
  if (args.includeSecrets !== undefined && typeof args.includeSecrets !== 'boolean') throw new BridgeError('bad-args', 'Invalid includeSecrets');
  return { sections: args.sections, entryIds: args.entryIds, timelineIds: args.timelineIds, mapIds: args.mapIds, relationshipIds: args.relationshipIds, includeSecrets: args.includeSecrets, locale: args.locale } as BibleSelection;
}
async function card(args:ToolArgs){
  selection(args);
  if(args.presentation!=='card')throw new BridgeError('bad-args','presentation must be card.');
  if(!Array.isArray(args.entryIds)||args.entryIds.length!==1||typeof args.entryIds[0]!=='string'||!args.entryIds[0].trim())throw new BridgeError('bad-args','card requires exactly one entryId.');
  if(args.sections!==undefined&&(!Array.isArray(args.sections)||args.sections.length!==1||args.sections[0]!=='codex'))throw new BridgeError('bad-args','card sections must be omitted or [codex].');
  for(const key of ['timelineIds','mapIds','relationshipIds'])if(args[key]!==undefined&&(!Array.isArray(args[key])||args[key].length))throw new BridgeError('bad-args','card cannot select other sections.');
  if(args.eraId!==undefined&&(typeof args.eraId!=='string'||!args.eraId.trim()))throw new BridgeError('bad-args','Invalid eraId.');
  const {prepareCodexEntryExport}=await import('@/services/codexEntryExport');
  return prepareCodexEntryExport({projectId:resolveProjectId(args),eraId:args.eraId as string|undefined,entryId:args.entryIds[0],locale:args.locale==='en'?'en':'es'});
}
export async function whBuildWorldBible(args: ToolArgs) {
  if(args.presentation!==undefined){const artifact=await card(args);return{html:artifact.prepared.html,title:artifact.entry.title,projectId:artifact.request.projectId,eraId:artifact.request.eraId??null,sourceVersion:artifact.prepared.sourceVersion,dependencies:artifact.prepared.dependencies,counts:{codex:1,timeline:0,maps:0,relationships:0}};}
  if(args.eraId!==undefined)throw new BridgeError('bad-args','eraId requires presentation card.');
  const projectId = resolveProjectId(args);
  return buildWorldBible(await loadBibleData(projectId), selection(args));
}
export async function whExportWorldBible(args: ToolArgs) {
  if (args.format !== 'html' && args.format !== 'pdf') throw new BridgeError('bad-args', 'format must be html or pdf');
  if(args.presentation!==undefined){const artifact=await card(args),{saveCodexEntryPdf,saveCodexEntryHtml}=await import('@/services/codexEntryExport');const result=args.format==='pdf'?await saveCodexEntryPdf(artifact):(saveCodexEntryHtml(artifact),{ok:true});return{...result,...('canceled'in result&&result.canceled?{code:'canceled',error:'PDF save canceled. No file was written.'}:{}),sourceVersion:artifact.prepared.sourceVersion,dependencies:artifact.prepared.dependencies,counts:{codex:1,timeline:0,maps:0,relationships:0}};}
  if(args.eraId!==undefined)throw new BridgeError('bad-args','eraId requires presentation card.');
  return exportWorldBible(resolveProjectId(args), selection(args), args.format);
}
