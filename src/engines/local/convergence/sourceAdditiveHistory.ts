import * as Y from 'yjs';
import {JsonArray,JsonMap,Registers} from './registers';
import {assertConvergenceIdentity,convergenceCanonical,convergenceCodecHash,convergenceEngine,convergenceHash,convergenceIdentity,validateConvergenceIdentity,validateConvergenceMetadata} from './format';
import {sourceDefaultEntries,sourceDefaultHash} from '../stateCodecFormat';
import {priorSourceCodec,sourcePromotionFields} from './sourceAdditive';
import {SOURCE_LIST_FORMAT,SOURCE_MULTI_FORMAT,SOURCE_SCALAR_FORMAT,SOURCE_SUCCESSIVE_FORMAT,SOURCE_LIST_AUTHORITY_ROOT,inspectSourceListStages,sourceListRetainedRegisters,sourceListFields,type SourceAuthorityFormat,type SourceListStage} from './sourceListHistory';
import type {CausalTransaction,LocalToolConvergenceIdentity,LocalToolConvergenceMetadata,RegisterActivation,RegisterVersion} from './formatTypes';

export const SOURCE_ADDITIVE_ROOT=SOURCE_LIST_AUTHORITY_ROOT;
interface SourceAdditiveAuthority {
 format:SourceAuthorityFormat;
 target:LocalToolConvergenceMetadata;
 promotion?:{txId:string;frontier:string[];from:LocalToolConvergenceMetadata};
}
const invalid=():never=>{throw Error('local_tool_source_additive_history_invalid');};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,keys:readonly string[])=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const metadata=(value:LocalToolConvergenceMetadata):LocalToolConvergenceMetadata=>({namespace:value.namespace,codec:value.codec,validationId:value.validationId,schemaEpoch:value.schemaEpoch});
const hasSlot=(value:unknown,field:string)=>record(value)&&Object.hasOwn(value,field);

function authorityFormat(codec:LocalToolConvergenceMetadata['codec']):SourceAdditiveAuthority['format'] {
 return codec.sourceDefaults?SOURCE_MULTI_FORMAT:sourceListFields(codec).length?SOURCE_LIST_FORMAT:SOURCE_SCALAR_FORMAT;
}

export function appendSourceAdditiveAuthority(doc:Y.Doc,target:LocalToolConvergenceMetadata,from?:LocalToolConvergenceMetadata):void {
 const successive=!!from&&convergenceEngine(from.codec).version==='8';
 const authority:SourceAdditiveAuthority={format:successive?SOURCE_SUCCESSIVE_FORMAT:authorityFormat(target.codec),target:metadata(target)};
 if(from){
  const registers=new Registers(doc);
  const origin=new JsonMap<LocalToolConvergenceIdentity>(doc.getMap('convergence-identity')).get('value');
  if(!origin||registers.pending())return invalid();
  const prior=convergenceIdentity(from,origin.genesisId);
  if(successive)checkSourceAdditiveHistory(doc,prior);
  else assertConvergenceIdentity(origin,prior);
  const txId=crypto.randomUUID(),frontier=registers.frontier();
  authority.promotion={txId,frontier,from:metadata(from)};
  registers.transactions.set(txId,{id:txId,parents:frontier});
 }
 new JsonArray<SourceAdditiveAuthority>(doc.getArray(SOURCE_ADDITIVE_ROOT)).push([authority]);
}

function checkedAuthority(item:SourceAdditiveAuthority,format:SourceAuthorityFormat):void {
 if(!record(item)||!exact(item,item.promotion===undefined?['format','target']:['format','target','promotion'])||
    item.format!==format||!exact(item.target,['namespace','codec','validationId','schemaEpoch']))return invalid();
 validateConvergenceMetadata(item.target);
 if(!sourceDefaultHash(item.target.codec))return invalid();
 if(item.promotion!==undefined){
  if(!exact(item.promotion,['txId','frontier','from'])||!exact(item.promotion.from,['namespace','codec','validationId','schemaEpoch']))return invalid();
  validateConvergenceMetadata(item.promotion.from);
 }
}

function checkPromotionBoundary(doc:Y.Doc,authority:SourceAdditiveAuthority,fields:readonly string[],retained:ReturnType<typeof sourceListRetainedRegisters>|undefined,previousPromotion?:string):void {
 if(!authority.promotion)return invalid();
 const {txId,frontier}=authority.promotion,codec=authority.target.codec;
 if(typeof txId!=='string'||!txId||
    !Array.isArray(frontier)||!frontier.length||frontier.some(id=>typeof id!=='string'||!id)||new Set(frontier).size!==frontier.length)return invalid();
 const transactions=new Map(new JsonMap<CausalTransaction>(doc.getMap('causal-transactions')));
 const children=new Map<string,string[]>(),remaining=new Map<string,number>(),complete:string[]=[];
 for(const [id,tx] of transactions){
  if(!tx||tx.id!==id||!Array.isArray(tx.parents)||tx.parents.some(parent=>typeof parent!=='string'||parent===id)||new Set(tx.parents).size!==tx.parents.length)return invalid();
  remaining.set(id,tx.parents.length);
  if(!tx.parents.length)complete.push(id);
  for(const parent of tx.parents){
   const next=children.get(parent);
   if(next)next.push(id);else children.set(parent,[id]);
  }
 }
 const transaction=transactions.get(txId);
 if(!transaction||convergenceCanonical(transaction.parents)!==convergenceCanonical(frontier))return invalid();
 const ancestors=new Set<string>(),before=[...frontier];
 const heads=new Set(frontier);
 while(before.length){
  const id=before.pop()!;
  if(ancestors.has(id))continue;
  const tx=transactions.get(id);
  if(!tx||id===txId)return invalid();
  ancestors.add(id);
  for(const parent of tx.parents){
   if(heads.has(parent))return invalid();
   before.push(parent);
  }
 }
 if(previousPromotion&&!ancestors.has(previousPromotion))return invalid();
 // The normal register validator checks the graph too. Here only complete transactions
 // decide admission, so an unrelated missing dependency cannot hide a known old writer.
 const after=new Set([txId]);
 for(let index=0;index<complete.length;index++){
  const id=complete[index];
  if(!ancestors.has(id)&&!after.has(id))return invalid();
  for(const child of children.get(id)??[]){
   if(after.has(id))after.add(child);
   const count=remaining.get(child)!-1;
   remaining.set(child,count);
   if(!count)complete.push(child);
  }
 }
 if(remaining.get(txId)!==0)return invalid();
 for(const version of retained?.versions??new JsonMap<RegisterVersion>(doc.getMap('register-versions')).values()){
  if(version.txId===txId)return invalid();
  const ancestor=ancestors.has(version.txId);
  for(const field of fields){
   const kind=codec.fields[field]?.kind,scalar=version.root==='scalar'&&version.key===field;
   if(kind==='map'&&scalar)return invalid();
   if(!ancestor)continue;
   const presence=version.root==='presence'&&version.key===field;
   if(scalar||kind==='map'&&(presence||version.root==='map:'+field)||
      kind==='list'&&(presence||['content:','membership:','selected:'].some(prefix=>version.root===prefix+field))||
      version.root==='authored-valid-snapshot'&&record(version.value)&&
      (hasSlot(version.value.data,field)||kind==='list'&&hasSlot(version.value.bindings,field)))return invalid();
  }
 }
 for(const activation of retained?.activations??new JsonMap<RegisterActivation>(doc.getMap('register-activations')).values())if(activation.txId===txId)return invalid();
}

/** Definition-free validation of the portable declaration and every exact promotion frontier. */
export function checkSourceAdditiveHistory(doc:Y.Doc,active:LocalToolConvergenceIdentity):readonly LocalToolConvergenceMetadata[] {
 if(active.engine.version!=='8'||!doc.share.has(SOURCE_ADDITIVE_ROOT)||doc.share.has('convergence-rich-adoptions'))return invalid();
 const root=doc.getArray<string>(SOURCE_ADDITIVE_ROOT),identityRoot=doc.getMap<string>('convergence-identity');
 for(const items of doc.store.clients.values())for(const item of items){
  if(item instanceof Y.Item&&item.deleted&&(item.parent===root||item.parent===identityRoot))return invalid();
 }
 const entries=new JsonArray<SourceAdditiveAuthority>(root).toArray();
 if(!entries.length||!entries[0]?.target?.codec)return invalid();
 const initial=entries[0];
 checkedAuthority(initial,authorityFormat(initial.target.codec));
 const successors=entries.slice(1).filter(item=>item?.format===SOURCE_SUCCESSIVE_FORMAT);
 for(const stage of successors)checkedAuthority(stage,SOURCE_SUCCESSIVE_FORMAT);
 if(!successors.length&&!sourceListFields(initial.target.codec).length&&entries.length!==1)return invalid();
 const origin=new JsonMap<LocalToolConvergenceIdentity>(identityRoot).get('value');
 validateConvergenceIdentity(origin);
 const initialIdentity=convergenceIdentity(initial.target,origin.genesisId);
 const initialFields=sourceDefaultEntries(initial.target.codec).map(([field])=>field);
 const chained=successors.length>0;
 const retained=chained||sourceListFields(initial.target.codec).length?sourceListRetainedRegisters(doc,chained):undefined;
 if(initial.promotion===undefined)assertConvergenceIdentity(origin,initialIdentity);
 else{
  const {from}=initial.promotion;
  if(origin.engine.version!=='1'||from.namespace!==initial.target.namespace||convergenceHash(from)!==sourceDefaultHash(initial.target.codec)||
     origin.codecHash!==convergenceCodecHash(priorSourceCodec(initial.target.codec,initialFields)))return invalid();
  assertConvergenceIdentity(origin,convergenceIdentity(from,origin.genesisId));
  checkPromotionBoundary(doc,initial,initialFields,retained);
 }
 const stages:SourceListStage[]=[{format:initial.format,fields:sourceListFields(initial.target.codec),promotionTxId:initial.promotion?.txId}];
 let previous=initial;
 for(const stage of successors){
  if(!stage.promotion||stage.target.namespace!==previous.target.namespace||
     convergenceCanonical(stage.promotion.from)!==convergenceCanonical(previous.target)||
     sourceDefaultHash(stage.target.codec)!==convergenceHash(previous.target))return invalid();
  let fields:string[];
  try{fields=sourcePromotionFields(previous.target.codec,stage.target.codec);}catch{return invalid();}
  checkPromotionBoundary(doc,stage,fields,retained,previous.promotion?.txId);
  stages.push({format:stage.format,fields:fields.filter(field=>stage.target.codec.fields[field].kind==='list'),promotionTxId:stage.promotion.txId});
  previous=stage;
 }
 assertConvergenceIdentity(active,convergenceIdentity(previous.target,origin.genesisId));
 const listSet=new Set(stages.flatMap(stage=>stage.fields));
 if(retained?.versions.some(version=>version.root==='scalar'&&listSet.has(version.key)))return invalid();
 if(listSet.size||stages.length>1)inspectSourceListStages(doc,stages);
 return [...(initial.promotion?[initial.promotion.from]:[]),initial.target,...successors.map(stage=>stage.target)];
}
