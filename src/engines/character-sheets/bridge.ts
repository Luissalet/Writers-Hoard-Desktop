import {FIVE_E_CLASSES,FIVE_E_ACTIONS,fiveEClassPreview,applyFiveEClass,setFiveEResource,upsertFiveESpell,prepareFiveESpell,setFiveECastingOverride,fiveEDerived} from './fiveE';
import type {SheetRow} from './types';
import { getEraProject, readEraRow, readWorldDocument } from '@/services/worldEras/store';
import {db} from '@/db';
import type { CodexEntry } from '@/types';
import { BridgeError, optString, requireString, resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { createSheet, exportSheet, parseSheetImport, presets, validateSheet, type CharacterSheet, type SheetPreset } from './types';
import { deleteSheet, saveSheet, SheetConflict } from './operations';
import { cocConditionKeys, cocDerivedKeys, type CocCondition, type CocDerivedKey } from './cocTypes';
import { applyCocDamage, applyCocSanityLoss, cocConstitution, cocIntelligence, cocRoll, cocSkillCanImprove, healCoc, improveCocSkill, pushCocRoll, resolveCocSheet, setCocOverride, setCocCondition, startCocDay } from './cocRules';
import { COC_ACTIONS } from './bridgeManifest';
import { applySheetInk,SHEET_INK_SURFACE,type SheetInkStroke } from './ink';
import {statBlockDerived} from './statBlock';
import {issueSheetReceipt} from './sheetUndo';
import {DAGGERHEART_CLASSES,daggerheartDerived,daggerheartClassPreview,applyDaggerheartClass,setDaggerheartResource} from './daggerheart';
import { cocSummary } from './cocSummary';
async function load(args:ToolArgs){const projectId=resolveProjectId(args),id=requireString(args,'sheetId');const sheet=(await getEraProject({ projectId, eraId: optString(args, 'eraId') }))?.characterSheets?.find(item=>item.id===id);if(!sheet)throw new BridgeError('not-found','Sheet not found in this project.');return {projectId,sheet:resolveCocSheet(sheet)};}
function revision(args:ToolArgs){if(!Number.isSafeInteger(args.revision)||(args.revision as number)<0)throw new BridgeError('bad-args','revision must be the current nonnegative integer revision.');return args.revision as number;}
async function write(projectId:string,sheet:CharacterSheet,expected:number|null,eraId?:string){try{return await db.transaction('rw',db.tables,async tx=>{const scope={projectId,eraId},before=expected===null?undefined:await readWorldDocument(scope,'character-sheets',sheet.id),saved=await saveSheet(projectId,sheet,expected,eraId),after=before?await readWorldDocument(scope,'character-sheets',sheet.id):undefined;const receiptId=before&&after?issueSheetReceipt(tx,scope,before,after.version):undefined;return withAudit({projectId,sheet:saved},{projectId,entityId:saved.id,kind:expected===null?'create':'update',summary:`Saved character sheet ${saved.title}`,...(receiptId?{before:{__sheetReceipt:receiptId}}:{})});});}catch(error){if(error instanceof SheetConflict)throw new BridgeError('conflict','Sheet changed. Read wh_sheet_get and reapply your action to the new revision.');throw error;}}
export const SHEET_HANDLERS={
  async wh_sheet_list(args:ToolArgs){if(args.includeSummary!==undefined&&typeof args.includeSummary!=='boolean')throw new BridgeError('bad-args','includeSummary must be a boolean.');const projectId=resolveProjectId(args),project=await getEraProject({ projectId, eraId: optString(args, 'eraId') });if(!project)throw new BridgeError('not-found','Project not found.');return {projectId,sheets:(project.characterSheets??[]).map(sheet=>{const {id,title,preset,revision,updatedAt}=sheet;return{id,title,preset,revision,updatedAt,...(args.includeSummary===true&&preset==='coc7'?{summary:cocSummary(sheet)}:{})};})};},
  async wh_sheet_get(args:ToolArgs){const result=await load(args);return{...result,...(result.sheet.preset==='5e-character'?{derived:{fiveE:fiveEDerived(result.sheet)}}:result.sheet.preset==='5e-stat-block'?{derived:{statBlock:statBlockDerived(result.sheet)}}:result.sheet.preset==='coc7'?{derived:{summary:cocSummary(result.sheet)}}:result.sheet.preset.startsWith('daggerheart')?{derived:{daggerheart:daggerheartDerived(result.sheet)}}:{})};},
  async wh_sheet_create(args:ToolArgs){const projectId=await resolveProjectForEngine(args,'character-sheets'),preset=requireString(args,'preset');if(!presets.includes(preset as SheetPreset))throw new BridgeError('bad-args','Unknown rules preset.');return write(projectId,createSheet(preset as SheetPreset,requireString(args,'title')),null,optString(args,'eraId'));},
  async wh_sheet_update(args:ToolArgs){await resolveProjectForEngine(args,'character-sheets');const {projectId,sheet}=await load(args);validateSheet(args.sheet);if(args.sheet.id!==sheet.id||args.sheet.preset!==sheet.preset)throw new BridgeError('bad-args','Sheet ID and preset cannot be replaced. Import to make a new sheet.');return write(projectId,args.sheet,revision(args),optString(args,'eraId'));},
  async wh_sheet_delete(args:ToolArgs){await resolveProjectForEngine(args,'character-sheets');const {projectId,sheet}=await load(args);try{await deleteSheet(projectId,sheet.id,revision(args),optString(args,'eraId'));}catch(error){if(error instanceof SheetConflict)throw new BridgeError('conflict','Sheet changed; read its current revision.');throw error;}return withAudit({projectId,sheetId:sheet.id,archived:true},{projectId,entityId:sheet.id,kind:'delete',summary:`Archived character sheet ${sheet.title}`});},
  async wh_sheet_export(args:ToolArgs){const {projectId,sheet}=await load(args);return {projectId,sheetId:sheet.id,json:exportSheet(sheet)};},
  async wh_sheet_import(args:ToolArgs){const projectId=await resolveProjectForEngine(args,'character-sheets'),sheet=parseSheetImport(requireString(args,'json'));if(sheet.linkedEntryId&&(await readEraRow<CodexEntry>({ projectId, eraId: optString(args,'eraId') }, 'codexEntries', sheet.linkedEntryId))?.projectId!==projectId)sheet.linkedEntryId=undefined;return write(projectId,sheet,null,optString(args,'eraId'));},
  async wh_sheet_ink_action(args:ToolArgs){
    await resolveProjectForEngine(args,'character-sheets');const {projectId,sheet}=await load(args),expected=revision(args);
    if(sheet.revision!==expected)throw new BridgeError('conflict','Sheet changed; read its current revision.');
    if(args.surface!==undefined&&args.surface!==SHEET_INK_SURFACE)throw new BridgeError('bad-args','Unknown sheet paper surface.');
    const action=requireString(args,'action');let next:CharacterSheet;
    if(action==='undo'){if(!sheet.ink?.strokes.length)throw new BridgeError('bad-args','No ink operation to undo.');next=applySheetInk(sheet,{kind:'undo'});}
    else{
      if(!['draw','erase'].includes(action)||!Array.isArray(args.points)||action==='draw'&&args.tool!==undefined&&!['pen','marker'].includes(String(args.tool)))throw new BridgeError('bad-args','Use draw, erase or undo. A stroke needs paper-space points.');
      const stroke={id:crypto.randomUUID(),tool:action==='erase'?'eraser':args.tool??'pen',color:args.color??'#272b2b',width:args.width??3,points:args.points} as SheetInkStroke;
      try{next=applySheetInk(sheet,{kind:'stroke',stroke});}catch{throw new BridgeError('bad-args','Invalid ink stroke: paper width1000, positive coordinates/width, hex colour and optional pressure0–1.');}
    }
    return write(projectId,next,expected,optString(args,'eraId'));
  },
  async wh_sheet_5e_preview(args:ToolArgs){const {projectId,sheet}=await load(args);try{return{projectId,sheetId:sheet.id,revision:sheet.revision,classes:FIVE_E_CLASSES,preview:fiveEClassPreview(sheet,requireString(args,'classId'),args.level===undefined?sheet.numbers.level:args.level as number)};}catch(error){throw new BridgeError('bad-args',error instanceof Error?error.message:'Invalid2014 profile.');}},
  async wh_sheet_5e_action(args:ToolArgs){
    await resolveProjectForEngine(args,'character-sheets');const {projectId,sheet}=await load(args),expected=revision(args),action=requireString(args,'action');if(sheet.revision!==expected)throw new BridgeError('conflict','Sheet changed; read its current revision.');
    if(!FIVE_E_ACTIONS.includes(action as typeof FIVE_E_ACTIONS[number]))throw new BridgeError('bad-args','Unknown2014 action.');let next:CharacterSheet;
    try{
      if(action==='configure'){if(!Array.isArray(args.fields)||args.fields.some(field=>typeof field!=='string'))throw Error('five_e_fields_invalid');next=applyFiveEClass(sheet,requireString(args,'classId'),args.level===undefined?sheet.numbers.level:args.level as number,args.fields as string[],args.recordClass===true);}
      else if(action==='resource'){if(typeof args.value!=='number')throw Error('five_e_resource_invalid');next=setFiveEResource(sheet,requireString(args,'resourceId'),args.value);}
      else if(action==='upsert-spell'){if(!args.row||typeof args.row!=='object'||Array.isArray(args.row))throw Error('five_e_spell_invalid');next=upsertFiveESpell(sheet,args.row as unknown as SheetRow);}
      else if(action==='prepare-spell'){if(typeof args.prepared!=='boolean')throw Error('five_e_spell_invalid');next=prepareFiveESpell(sheet,requireString(args,'rowId'),args.prepared);}
      else{if(args.value!==undefined&&typeof args.value!=='number')throw Error('five_e_override_invalid');next=setFiveECastingOverride(sheet,requireString(args,'key'),args.value as number|undefined);}
      validateSheet(next);
    }catch(error){throw new BridgeError('bad-args',error instanceof Error?error.message:'Invalid2014 action.');}
    if(next===sheet||JSON.stringify(next)===JSON.stringify(sheet))return{projectId,sheet,noChange:true};return write(projectId,next,expected,optString(args,'eraId'));
  },
  async wh_sheet_daggerheart_preview(args:ToolArgs){
    const {projectId,sheet}=await load(args);
    try{return{projectId,sheetId:sheet.id,revision:sheet.revision,classes:DAGGERHEART_CLASSES,preview:daggerheartClassPreview(sheet,requireString(args,'classId'))};}catch(error){throw new BridgeError('bad-args',error instanceof Error?error.message:'Invalid Daggerheart class.');}
  },
  async wh_sheet_daggerheart_action(args:ToolArgs){
    await resolveProjectForEngine(args,'character-sheets');const {projectId,sheet}=await load(args),expected=revision(args);
    if(sheet.revision!==expected)throw new BridgeError('conflict','Sheet changed; read its current revision.');
    let next:CharacterSheet;
    try{
      if(args.action==='apply-class'){
        if(!Array.isArray(args.fields)||args.fields.some(field=>typeof field!=='string'))throw Error('daggerheart_fields_invalid');
        next=applyDaggerheartClass(sheet,requireString(args,'classId'),args.fields);
      }else if(args.action==='resource'){
        if(typeof args.value!=='number')throw Error('daggerheart_resource_invalid');next=setDaggerheartResource(sheet,requireString(args,'resourceId'),args.value);
      }else throw Error('daggerheart_action_invalid');
      validateSheet(next);
    }catch(error){throw new BridgeError('bad-args',error instanceof Error?error.message:'Invalid Daggerheart action.');}
    if(next===sheet)return{projectId,sheet,noChange:true};
    return write(projectId,next,expected,optString(args,'eraId'));
  },  async wh_sheet_coc_action(args:ToolArgs){
    await resolveProjectForEngine(args,'character-sheets');const {projectId,sheet}=await load(args),expected=revision(args),action=requireString(args,'action');if(sheet.preset!=='coc7'||!COC_ACTIONS.includes(action as typeof COC_ACTIONS[number]))throw new BridgeError('bad-args','A CoC sheet and supported action are required.');
    // Refuse before consuming random dice; saveSheet repeats this check atomically.
    if(sheet.revision!==expected)throw new BridgeError('conflict','Sheet changed; read its current revision.');
    const amount=()=>{if(!Number.isSafeInteger(args.amount)||(args.amount as number)<0)throw new BridgeError('bad-args','amount must be a nonnegative integer.');return args.amount as number;};
    let next=sheet;
    if(action==='damage')next=applyCocDamage(sheet,amount());
    else if(action==='heal')next=healCoc(sheet,amount());
    else if(action==='sanity-loss')next=applyCocSanityLoss(sheet,amount());
    else if(action==='constitution')next=cocConstitution(sheet);
    else if(action==='intelligence')next=cocIntelligence(sheet);
    else if(action==='new-day')next=startCocDay(sheet);
    else if(action==='push')next=pushCocRoll(sheet,requireString(args,'rollId'),requireString(args,'justification'));
    else if(action==='improve-skill')next=improveCocSkill(sheet,requireString(args,'subjectId'));
    else if(action==='mark-skill'){const id=requireString(args,'subjectId'),skill=sheet.skills.find(item=>item.id===id);if(!skill||!cocSkillCanImprove(skill)||typeof args.enabled!=='boolean')throw new BridgeError('bad-args','An improvable skill and enabled boolean are required.');next.coc!.checkedSkills=args.enabled?[...new Set([...next.coc!.checkedSkills,id])]:next.coc!.checkedSkills.filter(item=>item!==id);}
    else if(action==='roll'){
      const id=requireString(args,'subjectId'),skill=sheet.skills.find(item=>item.id===id),trait=sheet.traits.find(item=>item.id===id),pool=sheet.resources.find(item=>item.id===id&&['sanity','luck'].includes(id));
      const difficulty=args.difficulty??'regular';if(!['regular','hard','extreme'].includes(String(difficulty))||!skill&&!trait&&!pool)throw new BridgeError('bad-args','Unknown roll subject or difficulty.');
      next=cocRoll(sheet,skill?.label??trait?.label??pool!.label,skill?skill.value+skill.bonus:trait?.value??pool!.current,{difficulty:difficulty as 'regular'|'hard'|'extreme',skillId:skill?.id,kind:skill?/^(Fighting|Firearms|Dodge)/.test(skill.label)?'combat':'skill':trait?'trait':id==='luck'?'luck':'sanity'});
    }else if(action==='mode'){
      if(args.era!==undefined&&!['1920s','modern'].includes(String(args.era))||args.pulp!==undefined&&typeof args.pulp!=='boolean')throw new BridgeError('bad-args','Invalid era or pulp.');
      if(args.era!==undefined){next.coc!.era=args.era as '1920s'|'modern';next.details.era=next.coc!.era;}if(args.pulp!==undefined)next.coc!.pulp=args.pulp as boolean;
      if(next.coc!.era==='modern'&&!next.skills.some(item=>item.label==='Electronics'))next.skills.push({id:crypto.randomUUID(),label:'Electronics',value:1,bonus:0,training:0});
    }else if(action==='override'){
      const key=requireString(args,'key') as CocDerivedKey;if(!cocDerivedKeys.includes(key)||args.value!==undefined&&(key==='damageBonus'?typeof args.value!=='string':typeof args.value!=='number'||!Number.isFinite(args.value)))throw new BridgeError('bad-args','Unknown calculated key or invalid override.');next=setCocOverride(sheet,key,args.value as number|string|undefined);
    }else if(action==='condition'){
      const key=requireString(args,'condition') as CocCondition;if(!cocConditionKeys.includes(key)||typeof args.enabled!=='boolean')throw new BridgeError('bad-args','Condition and enabled boolean are required.');next=setCocCondition(sheet,key,args.enabled);
    }else if(action==='stabilize'){next.coc!.conditions.dying=false;next.coc!.pendingCon=undefined;}
    return write(projectId,next,expected,optString(args,'eraId'));
  },
};
