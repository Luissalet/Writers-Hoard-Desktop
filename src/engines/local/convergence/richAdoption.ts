import * as Y from 'yjs';
import type {LocalToolConvergenceIdentity,LocalToolConvergenceMetadata,LocalToolRichAdoption,LocalToolConvergenceContract,LocalToolConvergenceUpdate,CausalTransaction,RegisterVersion} from './formatTypes';
import {assertConvergenceIdentity,convergenceCanonical,convergenceClone,convergenceIdentity,convergenceIdentityOf,validateConvergenceMetadata,validateConvergenceIdentity,validateLocalToolConvergenceUpdate,convergenceBytes,convergenceBase64,convergenceHash} from './format';
import {validateLocalToolCodecState,localToolRichLinks,isLocalToolRichBlockField,isLocalToolPlainField} from '../stateCodecFormat';
import {richBlockLeaves,validateRichBlockPlacement,type RichBlockDocument} from './blockFormat';
import {RICH_MARKS,type RichDocument} from './richTypes';
import {prepareRichSnapshotBindings} from './richSnapshot';
import {JsonArray,JsonMap} from './json';

export const RICH_ADOPTION_ROOT='convergence-rich-adoptions';
export const RICH_ADOPTION_MISSING='local_tool_rich_adoption_dependency_missing';
export const RICH_LEGACY_MISSING='local_tool_rich_legacy_dependency_missing';
const invalid=():never=>{throw Error('local_tool_rich_adoption_invalid');};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const same=(a:unknown,b:unknown)=>convergenceCanonical(a)===convergenceCanonical(b);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v:unknown):v is string=>typeof v==='string'&&!!v;
export interface RichAdoptionDeclaration {
 format:'writers-hoard-rich-adoption/1';transition:'rich-links-3-to-4/1';
 origin:LocalToolConvergenceIdentity;target:LocalToolConvergenceMetadata;txId:string;frontier:string[];
}
function graph(doc:Y.Doc){
 const transactions=new JsonMap<CausalTransaction>(doc.getMap('causal-transactions')),versions=new JsonMap<RegisterVersion>(doc.getMap('register-versions'));
 const ancestry=new Map<string,Set<string>>(),availability=new Map<string,boolean>();
 const ancestors=(id:string,seen=new Set<string>()):Set<string>=>{if(seen.has(id))return invalid();const cached=ancestry.get(id);if(cached)return cached;const next=new Set(seen);next.add(id);const result=new Set<string>();for(const parent of transactions.get(id)?.parents??[]){result.add(parent);for(const ancestor of ancestors(parent,next))result.add(ancestor);}ancestry.set(id,result);return result;};
 for(const[id,tx]of transactions)checkTransaction(id,tx);
 for(const id of transactions.keys())ancestors(id);
 const complete=(id:string):boolean=>{const cached=availability.get(id);if(cached!==undefined)return cached;const tx=transactions.get(id);let result=!!tx;for(const parent of tx?.parents??[])if(!complete(parent))result=false;availability.set(id,result);return result;};
 const frontier=()=>{const values=[...transactions.values()].filter(tx=>complete(tx.id)),heads=new Set(values.map(tx=>tx.id));for(const tx of values)for(const parent of tx.parents)heads.delete(parent);return[...heads].sort();};
 return{transactions,versions,ancestors,complete,frontier};
}
function checkTransaction(key:string|null,value:unknown):asserts value is CausalTransaction {
 if(!record(value)||!exact(value,['id','parents'])||value.id!==key||!text(value.id)||!Array.isArray(value.parents)||value.parents.some(id=>!text(id)||id===value.id)||new Set(value.parents).size!==value.parents.length)return invalid();
}
/** One declared pair, not a codec converter or an identity alias. */
export function validateRichAdoption(value:LocalToolRichAdoption,target:LocalToolConvergenceMetadata):void {
 const declaration=convergenceClone(value);
 if(!record(declaration)||!exact(declaration,['transition','from'])||declaration.transition!=='rich-links-3-to-4/1')return invalid();
 validateConvergenceMetadata(declaration.from);validateConvergenceMetadata(target);
 if(!exact(declaration.from as unknown as Record<string,unknown>,['namespace','codec','validationId','schemaEpoch']))return invalid();
 if(declaration.from.namespace!==target.namespace||declaration.from.codec.version!==2||target.codec.version!==2)return invalid();
 const from=declaration.from.codec.fields,to=target.codec.fields;
 if(!same(Object.keys(from).sort(),Object.keys(to).sort()))return invalid();let changed=false;
 for(const[field,old]of Object.entries(from)){
  const next=to[field];if(same(old,next))continue;
  if(old.kind!=='rich'||next.kind!=='rich')return invalid();
  if(old.profile==='paragraphs-inline/1'&&next.profile==='paragraphs-inline/2'){changed=true;continue;}
  if(old.profile==='blocks-tree/1'&&next.profile==='blocks-tree/2'&&old.schema===next.schema){changed=true;continue;}
  return invalid();
 }
 if(!changed||Object.values(from).some(localToolRichLinks))return invalid();
}
/** Reading or starting a durable3 checkpoint never adopts or interprets it as4. */
export function effectiveRichAdoptionContract<T extends import('../stateTypes').LocalToolJson>(checkpoint:LocalToolConvergenceIdentity,current:LocalToolConvergenceContract<T>):LocalToolConvergenceContract<T>{
 if(checkpoint.engine.version!=='3'||!current.richAdoption)return current;
 validateRichAdoption(current.richAdoption,current);assertConvergenceIdentity(checkpoint,convergenceIdentity(current.richAdoption.from,checkpoint.genesisId));
 return{...convergenceClone(current.richAdoption.from),validateState:current.validateState};
}
export function richAdoptionOrigin(doc:Y.Doc):LocalToolConvergenceIdentity {
 const origin=new JsonMap<LocalToolConvergenceIdentity>(doc.getMap('convergence-identity')).get('value');
 if(!origin||!exact(origin as unknown as Record<string,unknown>,['namespace','genesisId','codecHash','validationId','schemaEpoch','engine']))return invalid();validateConvergenceIdentity(origin);return convergenceIdentityOf(origin);
}
/** The declarations, including duplicates, are all checked. No winning/LWW declaration. */
export function readRichAdoption(doc:Y.Doc,active:LocalToolConvergenceIdentity,pair?:LocalToolRichAdoption):RichAdoptionDeclaration|null {
 const origin=richAdoptionOrigin(doc),items=new JsonArray<RichAdoptionDeclaration>(doc.getArray(RICH_ADOPTION_ROOT)).toArray();
 for(const structs of doc.store.clients.values())for(const item of structs)if(item instanceof Y.Item&&item.parent===doc.share.get(RICH_ADOPTION_ROOT)&&item.deleted)return invalid();
 if(same(origin,active)){if(items.length)return invalid();return null;}
 if(origin.engine.version!=='3'||active.engine.version!=='4')return invalid();
 checkRichAdoptionMonotonicity(doc,doc,new Uint8Array([0,0]));
 const registers=graph(doc);let complete=false,chosen:RichAdoptionDeclaration|undefined;
 for(const item of items){
  if(!record(item)||!exact(item,['format','transition','origin','target','txId','frontier'])||item.format!=='writers-hoard-rich-adoption/1'||item.transition!=='rich-links-3-to-4/1'||!text(item.txId)||!Array.isArray(item.frontier)||item.frontier.some(id=>!text(id))||new Set(item.frontier).size!==item.frontier.length)return invalid();
  if(!same(item.origin,origin)||!record(item.target)||!exact(item.target,['namespace','codec','validationId','schemaEpoch']))return invalid();validateConvergenceMetadata(item.target);
  assertConvergenceIdentity(convergenceIdentity(item.target,origin.genesisId),active);
  validateRichAdoption(richAdoptionPair(item),item.target);
  if(pair){validateRichAdoption(pair,item.target);assertConvergenceIdentity(convergenceIdentity(pair.from,origin.genesisId),origin);}
  const transaction=registers.transactions.get(item.txId);
  if(transaction&&!same(transaction.parents,item.frontier))return invalid();
  if(transaction&&registers.complete(item.txId)){complete=true;chosen=item;}
 }
 if(!complete||!chosen)throw Error(RICH_ADOPTION_MISSING);
 return convergenceClone(chosen);
}
/** Relay can derive only this known structural predecessor, never an executable old policy. */
export function richAdoptionPair(declaration:RichAdoptionDeclaration):LocalToolRichAdoption {
 const codec=convergenceClone(declaration.target.codec);
 for(const field of Object.values(codec.fields))if(field.kind==='rich'){if(field.profile==='paragraphs-inline/2')field.profile='paragraphs-inline/1';else if(field.profile==='blocks-tree/2')field.profile='blocks-tree/1';}
 const from={namespace:declaration.origin.namespace,codec,validationId:declaration.origin.validationId,schemaEpoch:declaration.origin.schemaEpoch},pair={transition:'rich-links-3-to-4/1' as const,from};
 validateRichAdoption(pair,declaration.target);assertConvergenceIdentity(convergenceIdentity(from,declaration.origin.genesisId),declaration.origin);return pair;
}
export const contentPacketFingerprint=(update:LocalToolConvergenceUpdate)=>convergenceHash({identity:convergenceIdentityOf(update),updateBase64:update.updateBase64});
/** Pure relay format preparation. Every previous byte is retained; package policy runs at each host. */
export function prepareAdoptedRoomContent(previous:LocalToolConvergenceUpdate,full:LocalToolConvergenceUpdate):LocalToolConvergenceUpdate {
 validateLocalToolConvergenceUpdate(previous);validateLocalToolConvergenceUpdate(full);if(full.engine.version!=='4'&&(previous.engine.version!=='4'||full.engine.version!=='3'))return invalid();
 const doc=new Y.Doc({gc:false}),before=new Y.Doc({gc:false});try{
  Y.applyUpdate(doc,convergenceBytes(previous.updateBase64));const origin=richAdoptionOrigin(doc),active=convergenceIdentityOf(full.engine.version==='4'?full:previous);
  Y.applyUpdate(before,convergenceBytes(previous.updateBase64));
  if(previous.engine.version==='3')assertConvergenceIdentity(previous,origin);else{assertConvergenceIdentity(previous,active);if(!readRichAdoption(doc,active))return invalid();}
  if(full.engine.version==='3')assertConvergenceIdentity(full,origin);
  const bytes=convergenceBytes(full.updateBase64);Y.applyUpdate(doc,bytes);checkRichAdoptionMonotonicity(before,doc,bytes);const declaration=readRichAdoption(doc,active);if(!declaration)return invalid();
  if(previous.engine.version==='3')inspectLegacyRichUpdate(doc,convergenceBytes(previous.updateBase64),richAdoptionPair(declaration).from,origin);
  if(full.engine.version==='3')inspectLegacyRichUpdate(doc,bytes,richAdoptionPair(declaration).from,origin);
  checkRichAdoptionAncestors(doc,declaration);
  return{format:'writers-hoard-local-convergence-update/1',...active,updateBase64:convergenceBase64(Y.encodeStateAsUpdate(doc))};
 }finally{doc.destroy();before.destroy();}
}
/** Append D and its causal transaction; it has no activation/Undo receipt. */
export function appendRichAdoption(doc:Y.Doc,target:LocalToolConvergenceMetadata,pair:LocalToolRichAdoption):void {
 validateRichAdoption(pair,target);const origin=richAdoptionOrigin(doc);
 assertConvergenceIdentity(origin,convergenceIdentity(pair.from,origin.genesisId));
 const registers=graph(doc),txId=crypto.randomUUID(),frontier=registers.frontier();
 doc.transact(()=>{
  registers.transactions.set(txId,{id:txId,parents:frontier});
  new JsonArray<RichAdoptionDeclaration>(doc.getArray(RICH_ADOPTION_ROOT)).push([{format:'writers-hoard-rich-adoption/1',transition:pair.transition,origin,target:convergenceClone(target),txId,frontier}]);
  const fields=Object.keys(target.codec.fields).filter(field=>localToolRichLinks(target.codec.fields[field])).sort();
  new JsonMap<string[]>(doc.getMap('rich-link-fields')).set('value',fields);
 });
}

type Location={root:string;key:string|null};
/** Resolve encoded Items as well as integrated Items; never infer a root from payload resemblance. */
function locations(doc:Y.Doc,structs:ReturnType<typeof Y.decodeUpdate>['structs']){
 const find=(id:Y.ID):Y.Item|undefined=>{
  const integrated=doc.store.clients.get(id.client)?.find(item=>item.id.clock<=id.clock&&id.clock<item.id.clock+item.length);
  const item=integrated instanceof Y.Item?integrated:structs.find(item=>item instanceof Y.Item&&item.id.client===id.client&&item.id.clock<=id.clock&&id.clock<item.id.clock+item.length);
  return item instanceof Y.Item?item:undefined;
 };
 const direct=(item:Y.Item):Location|undefined=>{
  const parent=item.parent;if(typeof parent==='string')return{root:parent,key:item.parentSub};
  if(parent instanceof Y.AbstractType){
   if(parent._item)return invalid();
   for(const[root,type]of doc.share)if(type===parent)return{root,key:item.parentSub};return undefined;
  }
  return undefined;
 };
 const rootOf=(item:Y.Item,seen:Set<Y.Item>):Location|undefined=>{
  const known=direct(item);if(known)return known;
  if(seen.has(item))return invalid();const next=new Set(seen);next.add(item);
  if(item.parent instanceof Y.ID){const owner=find(item.parent);if(owner&&rootOf(owner,next))return invalid();return undefined;}
  let result:Location|undefined;
  for(const anchor of[item.origin,item.rightOrigin]){const previous=anchor?find(anchor):undefined,location=previous?rootOf(previous,next):undefined;if(!location)continue;const current={root:location.root,key:item.parentSub??location.key};if(result&&!same(result,current))return invalid();result=current;}
  return result;
 };
 const resolve=(item:Y.Item):Location|undefined=>{
  let result=rootOf(item,new Set());
  for(const anchor of[item.origin,item.rightOrigin]){const previous=anchor?find(anchor):undefined,location=previous?rootOf(previous,new Set([item])):undefined;if(!location)continue;const current={root:location.root,key:item.parentSub??location.key};if(result&&!same(result,current))return invalid();result=current;}
  return result;
 };
 const next=(client:number,clock:number,end:number)=>{let at=end;for(const item of[...doc.store.clients.get(client)??[],...structs])if(item instanceof Y.Item&&item.id.client===client&&item.id.clock>clock&&item.id.clock<at)at=item.id.clock;return at;};
 return{find,resolve,next};
}
/** D and the causal bodies it already names are append-only, including full4 packets. */
export function checkRichAdoptionMonotonicity(previous:Y.Doc,candidate:Y.Doc,bytes:Uint8Array):void {
 const decoded=Y.decodeUpdate(bytes),lookup=locations(candidate,decoded.structs),support=new Set<string>();
 for(const doc of[previous,candidate]){
  const transactions=new JsonMap<CausalTransaction>(doc.getMap('causal-transactions')),ownLookup=locations(doc,[]),pending:string[]=[];
  for(const structs of doc.store.clients.values())for(const item of structs)if(item instanceof Y.Item&&ownLookup.resolve(item)?.root===RICH_ADOPTION_ROOT){
   if(item.deleted)return invalid();
   for(const encoded of item.content.getContent()){
    if(typeof encoded!=='string')return invalid();let declaration:unknown;try{declaration=JSON.parse(encoded);}catch{return invalid();}
    if(!record(declaration)||!text(declaration.txId)||!Array.isArray(declaration.frontier)||declaration.frontier.some(id=>!text(id)))return invalid();pending.push(declaration.txId,...declaration.frontier as string[]);
   }
  }
  const visited=new Set<string>();while(pending.length){const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);support.add(id);const tx=transactions.get(id);if(tx){checkTransaction(id,tx);pending.push(...tx.parents);}}
 }
 const prior=new JsonMap<CausalTransaction>(previous.getMap('causal-transactions')),next=new JsonMap<CausalTransaction>(candidate.getMap('causal-transactions'));
 // A declaration may itself be pending on Yjs clocks. Its known DS targets
 // still cannot be retired merely because it is not in array.toArray() yet.
 const pending:string[]=[];
 for(const item of decoded.structs)if(item instanceof Y.Item&&lookup.resolve(item)?.root===RICH_ADOPTION_ROOT)for(const encoded of item.content.getContent()){
  if(typeof encoded!=='string')return invalid();let declaration:unknown;try{declaration=JSON.parse(encoded);}catch{return invalid();}if(!record(declaration)||!text(declaration.txId)||!Array.isArray(declaration.frontier)||declaration.frontier.some(id=>!text(id)))return invalid();pending.push(declaration.txId,...declaration.frontier as string[]);
 }
 const visited=new Set<string>();while(pending.length){const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);support.add(id);const tx=next.get(id)??prior.get(id);if(tx){checkTransaction(id,tx);pending.push(...tx.parents);}}
 for(const id of support){const known=prior.get(id),current=next.get(id);if(known&&(!current||!same(known,current)))return invalid();}
 for(const structs of candidate.store.clients.values())for(const item of structs)if(item instanceof Y.Item){const location=lookup.resolve(item);if(location?.root==='causal-transactions'&&location.key!==null&&support.has(location.key)){if(item.deleted)return invalid();for(const encoded of item.content.getContent()){if(typeof encoded!=='string')return invalid();let body:unknown;try{body=JSON.parse(encoded);}catch{return invalid();}const current=next.get(location.key);if(!current||!same(body,current))return invalid();}}}
 // Resolve DS targets against both cuts, not only the materialized map winner.
 const oldLookup=locations(previous,decoded.structs);
 for(const[client,ranges]of decoded.ds.clients)for(const range of ranges){let clock=range.clock;const end=range.clock+range.len;while(clock<end){const item=lookup.find(Y.createID(client,clock))??oldLookup.find(Y.createID(client,clock));if(!item){clock=Math.min(lookup.next(client,clock,end),oldLookup.next(client,clock,end));continue;}const location=lookup.resolve(item)??oldLookup.resolve(item);if(location?.root===RICH_ADOPTION_ROOT||location?.root==='causal-transactions'&&location.key!==null&&support.has(location.key))return invalid();clock=Math.min(end,item.id.clock+item.length);}}
}
function legacyRoot(root:string,from:LocalToolConvergenceMetadata):'map'|'array'|undefined {
 if(['convergence-identity','plain-fields','rich-fields','block-fields','causal-transactions','register-versions','register-activations'].includes(root))return'map';
 for(const[field,descriptor]of Object.entries(from.codec.fields)){
  if(descriptor.kind==='list'&&root==='order:'+JSON.stringify(field))return'array';
  if(descriptor.kind==='rich'){
   const prefix='rich3:'+JSON.stringify(field)+':';if(root.startsWith(prefix)){const tail=root.slice(prefix.length);if(['nodes','buffers','edges','lineage'].includes(tail))return'map';if(['order','segments'].includes(tail))return'array';}
  }
 }
 for(const prefix of['plain-content:','plain-order:'])if(root.startsWith(prefix)){
  let field:unknown;try{field=JSON.parse(root.slice(prefix.length));}catch{return undefined;}
  if(typeof field!=='string'||root!==prefix+JSON.stringify(field))return undefined;
  if(isLocalToolPlainField(from.codec.fields[field]))return prefix==='plain-order:'?'array':'map';
  let tuple:unknown;try{tuple=JSON.parse(field);}catch{return undefined;}
  if(Array.isArray(tuple)&&tuple.length===3&&tuple[0]==='rich3'&&text(tuple[1])&&from.codec.fields[tuple[1]]?.kind==='rich'&&text(tuple[2])&&JSON.stringify(tuple)===field)return prefix==='plain-order:'?'array':'map';
 }
 return undefined;
}
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function point(value:unknown,size:2|3):void {
 if(!text(value))return invalid();let tuple:unknown;try{tuple=JSON.parse(value);}catch{return invalid();}
 if(!Array.isArray(tuple)||tuple.length!==size||tuple.slice(0,-1).some(v=>!text(v))||!integer(tuple.at(-1))||JSON.stringify(tuple)!==value)return invalid();
}
function reference(value:unknown):void {
 if(!record(value))return invalid();if(exact(value,['edge'])&&text(value.edge))return;
 if(!exact(value,['unit']))return invalid();point(value.unit,3);
}
function spans(value:unknown,doc:Y.Doc,field:string,nonempty=false,ordered=false):void {
 if(!Array.isArray(value)||nonempty&&!value.length)return invalid();const seen=new Map<string,{from:number;to:number}[]>();let previous:{buffer:string;runId:string;from:number;to:number}|undefined;
 for(const span of value){
  if(!record(span)||!exact(span,['buffer','runId','from','to'])||!text(span.buffer)||!text(span.runId)||!integer(span.from)||!integer(span.to)||span.from>=span.to)return invalid();
  const key=JSON.stringify([span.buffer,span.runId]),old=seen.get(key)??[],from=span.from,to=span.to;if(old.some(s=>from<s.to&&s.from<to))return invalid();old.push({from,to});seen.set(key,old);
  if(ordered&&previous&&(previous.buffer>span.buffer||previous.buffer===span.buffer&&(previous.runId>span.runId||previous.runId===span.runId&&previous.to>=from)))return invalid();previous={buffer:span.buffer,runId:span.runId,from,to};
  const root='plain-content:'+JSON.stringify(JSON.stringify(['rich3',field,span.buffer])),run=new JsonMap<{length:number}>(doc.getMap(root)).get(span.runId);if(run&&span.to>run.length)return invalid();
 }
}
function snapshot(value:unknown,from:LocalToolConvergenceMetadata):void {
 if(!record(value)||!record(value.data)||!record(value.bindings)||!exact(value,['data','bindings',...['plainBindings','richBindings','blockBindings'].filter(key=>Object.hasOwn(value,key))]))return invalid();
 validateLocalToolCodecState(value.data as import('../stateTypes').LocalToolJson,from.codec);
 for(const[field,bindings]of Object.entries(value.bindings)){
  const descriptor=from.codec.fields[field];if(descriptor?.kind!=='list'||!Array.isArray(bindings))return invalid();const ids=new Set<string>();
  for(const b of bindings){if(!record(b)||!exact(b,['id','placementId'])||!text(b.id)||!text(b.placementId)||ids.has(b.id))return invalid();ids.add(b.id);}
  const rows=value.data[field];if(!Array.isArray(rows)||rows.length!==bindings.length||rows.some(row=>!record(row)||!ids.has(row[descriptor.idKey] as string)))return invalid();
 }
 const plain=value.plainBindings??{},rich=value.richBindings??{},blocks=value.blockBindings??{};
 if(!record(plain)||!record(rich)||!record(blocks))return invalid();
 for(const[field,list]of Object.entries(plain)){
  if(!isLocalToolPlainField(from.codec.fields[field])||!Array.isArray(list)||typeof value.data[field]!=='string')return invalid();let length=0;const seen=new Map<string,{from:number;to:number}[]>();
  for(const span of list){if(!record(span)||!exact(span,['runId','from','to'])||!text(span.runId)||!integer(span.from)||!integer(span.to)||span.from>=span.to)return invalid();const start=span.from,end=span.to,old=seen.get(span.runId)??[];if(old.some(s=>start<s.to&&s.from<end))return invalid();old.push({from:start,to:end});seen.set(span.runId,old);length+=end-start;}
  if(length!==value.data[field].length)return invalid();
 }
 for(const[field,stored]of Object.entries(rich)){
  const data=value.data[field],descriptor=from.codec.fields[field];if(descriptor?.kind!=='rich')return invalid();
  const leaves=isLocalToolRichBlockField(descriptor)?richBlockLeaves(data as unknown as RichBlockDocument):data as unknown as RichDocument;prepareRichSnapshotBindings(leaves,stored,()=>{},false);
 }
 for(const[field,stored]of Object.entries(blocks)){
  const data=value.data[field];if(!isLocalToolRichBlockField(from.codec.fields[field])||!record(data)||!Array.isArray(data.blocks)||!record(stored)||!exact(stored,['format','nodes'])||stored.format!=='writers-hoard-block-bindings/1'||!Array.isArray(stored.nodes)||stored.nodes.length!==data.blocks.length)return invalid();const ids=new Set<string>();
  for(const node of stored.nodes){if(!record(node)||!exact(node,['id','kindVersionId','attrsVersionId','membershipVersionId','placementVersionId'])||Object.values(node).some(v=>!text(v))||ids.has(node.id as string))return invalid();ids.add(node.id as string);}
  if(data.blocks.some(b=>!record(b)||!ids.has(b.id as string)))return invalid();
 }
 for(const[field,descriptor]of Object.entries(from.codec.fields))if(value.data[field]!==undefined){
  if(descriptor.kind==='list'&&!Object.hasOwn(value.bindings,field)||isLocalToolPlainField(descriptor)&&!Object.hasOwn(plain,field)||descriptor.kind==='rich'&&!Object.hasOwn(rich,field)||isLocalToolRichBlockField(descriptor)&&!Object.hasOwn(blocks,field))return invalid();
 }
}
function checkLegacyValue(location:Location,value:unknown,from:LocalToolConvergenceMetadata,origin:LocalToolConvergenceIdentity,doc:Y.Doc){
 if(location.root==='convergence-identity'){if(location.key!=='value')return invalid();assertConvergenceIdentity(value as LocalToolConvergenceIdentity,origin);}
 if(['plain-fields','rich-fields','block-fields'].includes(location.root)){
  const expected=Object.keys(from.codec.fields).filter(field=>location.root==='plain-fields'?isLocalToolPlainField(from.codec.fields[field]):location.root==='block-fields'?isLocalToolRichBlockField(from.codec.fields[field]):from.codec.fields[field].kind==='rich').sort();
  if(location.key!=='value'||!same(value,expected))return invalid();
 }
 if(location.root==='register-versions'){
  if(!record(value)||!exact(value,['id','root','key','present','value','txId'])||value.id!==location.key||!text(value.root)||!text(value.key)||typeof value.present!=='boolean'||!text(value.txId))return invalid();
  const version=value as unknown as RegisterVersion;
  const known=['scalar','presence','authored-valid-snapshot'].includes(version.root)||Object.entries(from.codec.fields).some(([field,descriptor])=>{
   if(descriptor.kind==='map'&&version.root==='map:'+field)return true;
   if(descriptor.kind==='list'&&['content:','membership:','selected:'].some(prefix=>version.root===prefix+field))return true;
   if(descriptor.kind==='rich'&&['membership','selected','edge','routing','marks'].some(suffix=>version.root==='rich3:'+JSON.stringify(field)+':'+suffix))return true;
   return isLocalToolRichBlockField(descriptor)&&['kind','attrs','membership','placement'].some(suffix=>version.root==='blocks3:'+JSON.stringify(field)+':'+suffix);
  })||version.root.startsWith('plain-membership:')&&legacyRoot('plain-content:'+version.root.slice('plain-membership:'.length),from)==='map';
  if(!known)return invalid();
  if(version.root==='scalar'&&version.present)validateLocalToolCodecState({[version.key]:version.value},from.codec);
  if(version.root==='presence'&&(from.codec.fields[version.key]===undefined||version.present&&typeof version.value!=='boolean'))return invalid();
  if(version.root.startsWith('plain-membership:')){
   const v=version.value;if(!version.present||!record(v)||!exact(v,['runId','from','to','visible'])||!text(v.runId)||!integer(v.from)||!integer(v.to)||v.from>=v.to||typeof v.visible!=='boolean')return invalid();
   const run=new JsonMap<{length:number}>(doc.getMap('plain-content:'+version.root.slice('plain-membership:'.length))).get(v.runId);if(run&&v.to>run.length)return invalid();
  }
  for(const[field,descriptor]of Object.entries(from.codec.fields)){
   if(descriptor.kind==='list'){
    if(version.present&&version.root==='membership:'+field&&typeof version.value!=='boolean')return invalid();
    if(version.present&&version.root==='selected:'+field&&!text(version.value))return invalid();
    if(version.present&&version.root==='content:'+field){if(!record(version.value)||version.value[descriptor.idKey]!==version.key)return invalid();validateLocalToolCodecState({[field]:[version.value]},from.codec);}
   }
   if(descriptor.kind==='map'&&version.present&&version.root==='map:'+field)validateLocalToolCodecState({[field]:{[version.key]:version.value}},from.codec);
   if(descriptor.kind!=='rich')continue;
   const prefix='rich3:'+JSON.stringify(field)+':';
   if(version.root===prefix+'membership'&&(!version.present||typeof version.value!=='boolean'))return invalid();
   if([prefix+'selected',prefix+'edge'].includes(version.root)&&(!version.present||!text(version.value)))return invalid();
   if(version.root===prefix+'routing'){
    const v=version.value;if(!version.present||!record(v)||!exact(v,['spans','edges','node','segment',...(Object.hasOwn(v,'ordinal')?['ordinal']:[]),...(Object.hasOwn(v,'excludes')?['excludes']:[])])||!Array.isArray(v.edges)||v.edges.some(e=>!text(e))||v.node!==null&&!text(v.node)||!text(v.segment)||Object.hasOwn(v,'ordinal')&&!integer(v.ordinal))return invalid();
    spans(v.spans,doc,field);if(Object.hasOwn(v,'excludes')){if(!Object.hasOwn(v,'ordinal'))return invalid();spans(v.excludes,doc,field,true,true);for(const mask of v.excludes as {buffer:string;runId:string;from:number;to:number}[])for(const included of v.spans as typeof mask[])if(mask.buffer===included.buffer&&mask.runId===included.runId&&mask.from<included.to&&included.from<mask.to)return invalid();}
   }
   if(version.root===prefix+'marks'){
    const mark=version.value;if(!version.present||!record(mark)||!exact(mark,['spans','mark','enabled'])||!RICH_MARKS.includes(mark.mark as typeof RICH_MARKS[number])||typeof mark.enabled!=='boolean')return invalid();spans(mark.spans,doc,field,true);
   }
   if(isLocalToolRichBlockField(descriptor)&&version.root.startsWith('blocks3:'+JSON.stringify(field)+':')){
    const suffix=version.root.slice(('blocks3:'+JSON.stringify(field)+':').length);if(!version.present)return invalid();
    if(suffix==='kind'&&!['paragraph','heading','bullet-list','ordered-list','list-item','blockquote','toggle'].includes(version.value as string))return invalid();
    if(suffix==='attrs'){
     const attrs=version.value;if(!record(attrs)||!(exact(attrs,[])||exact(attrs,['level'])&&[1,2,3].includes(attrs.level as number)||exact(attrs,['start'])&&integer(attrs.start)&&attrs.start>=1))return invalid();
    }
    if(suffix==='membership'&&typeof version.value!=='boolean')return invalid();
    if(suffix==='placement')validateRichBlockPlacement(version.value);
   }
  }
  if(/^rich3:.*:marks$/.test(version.root)){
   const mark=version.value;
   if(!version.present||!record(mark)||!exact(mark,['spans','mark','enabled'])||!RICH_MARKS.includes(mark.mark as typeof RICH_MARKS[number])||typeof mark.enabled!=='boolean')return invalid();
  }
  if(version.root==='authored-valid-snapshot'&&version.present){
   if(version.key!=='view')return invalid();snapshot(version.value,from);
  }
 }
 if(location.root==='causal-transactions'){
  checkTransaction(location.key,value);
 }
 if(location.root==='register-activations'&&(!record(value)||!exact(value,['id','versionId','enabled','txId'])||value.id!==location.key||!text(value.versionId)||typeof value.enabled!=='boolean'||!text(value.txId)))return invalid();
 for(const[field,descriptor]of Object.entries(from.codec.fields)){
  if(descriptor.kind==='list'&&location.root==='order:'+JSON.stringify(field)&&(!record(value)||!exact(value,['id','placementId'])||!text(value.id)||!text(value.placementId)))return invalid();
  if(descriptor.kind!=='rich')continue;const prefix='rich3:'+JSON.stringify(field)+':';if(!location.root.startsWith(prefix))continue;
  if(!record(value))return invalid();const suffix=location.root.slice(prefix.length);
  if(suffix==='nodes'&&(!exact(value,['id','birthId','txId'])||!text(value.id)||value.birthId!==location.key||!text(value.birthId)||!text(value.txId)))return invalid();
  if(suffix==='buffers'&&(!exact(value,['id','txId'])||value.id!==location.key||!text(value.id)||!text(value.txId)))return invalid();
  if(suffix==='edges'){if(!exact(value,['id','buffer','fallback','txId'])||value.id!==location.key||!text(value.id)||!text(value.buffer)||!text(value.txId))return invalid();if(value.fallback!==null)reference(value.fallback);}
  if(suffix==='lineage'){if(!exact(value,['buffer','runId','ref','before','txId'])||!text(value.buffer)||!text(value.runId)||location.key!==JSON.stringify([value.buffer,value.runId])||typeof value.before!=='boolean'||!text(value.txId))return invalid();reference(value.ref);}
  if(suffix==='order'&&(!exact(value,['id','node'])||!text(value.id)||!text(value.node)))return invalid();
  if(suffix==='segments'&&(!exact(value,['id','node','buffer'])||!text(value.id)||!text(value.node)||!text(value.buffer)))return invalid();
 }
 if(location.root.startsWith('plain-content:')){
  if(!record(value)||!exact(value,['id','length','bytes','txId'])||value.id!==location.key||!text(value.id)||!integer(value.length)||value.length===0||typeof value.bytes!=='string'||!text(value.txId)||convergenceBytes(value.bytes).length!==value.length*2)return invalid();
 }
 if(location.root.startsWith('plain-order:')){
  if(!record(value)||!exact(value,['runId','after','txId'])||!text(value.runId)||!text(value.txId))return invalid();if(value.after!==null)point(value.after,2);
 }
}
/** Original bytes remain unchanged. Every retained item and DS target is classified, not just winners. */
export function inspectLegacyRichUpdate(doc:Y.Doc,bytes:Uint8Array,from:LocalToolConvergenceMetadata,origin:LocalToolConvergenceIdentity):void {
 const decoded=Y.decodeUpdate(bytes),lookup=locations(doc,decoded.structs),bodies=new Map<string,string>(),transactions=new Map<string,CausalTransaction>(new JsonMap<CausalTransaction>(doc.getMap('causal-transactions')));let missing=false;
 // Include retained overwritten/deleted integrated items to detect conflicting immutable bodies.
 const retained=[...doc.store.clients.values()].flat().filter((item):item is Y.Item=>item instanceof Y.Item);
 for(const item of[...retained,...decoded.structs]){
  if(!(item instanceof Y.Item)){if(item instanceof Y.GC)missing=true;continue;}
  const location=lookup.resolve(item);if(!location){missing=true;continue;}
  // Existing capability4 in the repair candidate is not an ORIGINAL3 contribution.
  const original=decoded.structs.some(s=>s.id.client===item.id.client&&s.id.clock<item.id.clock+item.length&&item.id.clock<s.id.clock+s.length);
  if(original&&!legacyRoot(location.root,from))return invalid();
  const values=item.content.getContent();
  if(original&&item.content instanceof Y.ContentDeleted){missing=true;continue;}
  if(original&&!(item.content instanceof Y.ContentAny))return invalid();
  for(const encoded of values){
   if(typeof encoded!=='string'){if(original)return invalid();continue;}
   let value:unknown;try{value=JSON.parse(encoded);}catch{if(original)return invalid();continue;}
   if(original){convergenceClone(value);const kind=legacyRoot(location.root,from);if(kind==='map'&&location.key===null||kind==='array'&&location.key!==null)return invalid();try{checkLegacyValue(location,value,from,origin,doc);}catch{return invalid();}}
   if(location.root==='causal-transactions'){checkTransaction(location.key,value);transactions.set(value.id,value);}
   if(location.key!==null){const key=JSON.stringify([location.root,location.key]),body=convergenceCanonical(value),prior=bodies.get(key);if(prior!==undefined&&prior!==body)return invalid();bodies.set(key,body);}
   if(original&&location.root==='register-activations'&&record(value)&&text(value.versionId)&&!new JsonMap<RegisterVersion>(doc.getMap('register-versions')).has(value.versionId))missing=true;
  }
 }
 for(const[client,ranges]of decoded.ds.clients)for(const range of ranges){
  let clock=range.clock;const end=range.clock+range.len;while(clock<end){const item=lookup.find(Y.createID(client,clock));if(!item){missing=true;clock=lookup.next(client,clock,end);continue;}const location=lookup.resolve(item);if(!location)missing=true;else if(!legacyRoot(location.root,from))return invalid();clock=Math.min(end,item.id.clock+item.length);}
 }
 // A missing parent never short-circuits a cycle elsewhere in the known graph.
 const done=new Set<string>();const visit=(id:string,path:Set<string>)=>{if(path.has(id))return invalid();if(done.has(id))return;const next=new Set(path);next.add(id);for(const parent of transactions.get(id)?.parents??[])visit(parent,next);done.add(id);};for(const[id,tx]of transactions){checkTransaction(id,tx);visit(id,new Set());}
 if(missing)throw Error(RICH_LEGACY_MISSING);
}
/** A capability4 contribution must descend from one COMPLETE declaration transaction. */
export function checkRichAdoptionAncestors(doc:Y.Doc,declaration:RichAdoptionDeclaration){
 const registers=graph(doc),declarations=new JsonArray<RichAdoptionDeclaration>(doc.getArray(RICH_ADOPTION_ROOT)).toArray(),ids=declarations.filter(d=>same(d.origin,declaration.origin)&&same(d.target,declaration.target)&&registers.complete(d.txId)).map(d=>d.txId);
 const versions:RegisterVersion[]=[],bodies=new Map<string,string>(),lookup=locations(doc,[]);
 for(const structs of doc.store.clients.values())for(const item of structs)if(item instanceof Y.Item){
  const location=lookup.resolve(item);if(!location)continue;
  if(location.root!==RICH_ADOPTION_ROOT&&location.root!=='rich-link-fields'&&!legacyRoot(location.root,declaration.target))return invalid();
  for(const encoded of item.content.getContent()){
   if(typeof encoded!=='string')return invalid();let value:unknown;try{value=JSON.parse(encoded);}catch{return invalid();}convergenceClone(value);
   if(location.key!==null){const key=JSON.stringify([location.root,location.key]),body=convergenceCanonical(value),prior=bodies.get(key);if(prior!==undefined&&prior!==body)return invalid();bodies.set(key,body);}
   if(location.root==='register-versions')versions.push(value as RegisterVersion);
  }
 }
 for(const version of versions){
  const value=version.value,link=/^rich3:.*:marks$/.test(version.root)&&record(value)&&value.mark==='link',snapshot=version.root==='authored-valid-snapshot'&&record(value)&&record(value.richBindings)&&Object.values(value.richBindings).some(v=>record(v)&&v.format==='writers-hoard-rich-snapshot-bindings/2');
  if((link||snapshot)&&!ids.some(id=>registers.ancestors(version.txId).has(id)))return invalid();
 }
}
