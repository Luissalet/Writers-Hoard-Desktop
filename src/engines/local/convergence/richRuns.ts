import type {RichUnitBinding,RichBindings} from './richTypes';
export type {RichUnitBinding,RichBindings} from './richTypes';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
import type * as Y from 'yjs';
import type {LocalToolJson} from '../stateTypes';
import {convergenceClone,convergenceCanonical,assertConvergenceIdentity} from './format';
import {JsonMap,JsonArray,Registers,type RegisterVersion} from './registers';
import {PlainRuns,type PlainDraft,type PlainPlan} from './plainRuns';
import type {LocalToolConvergenceIdentity} from './types';
import {RICH_MARKS,RICH_MARK_KEYS,validateRichDocument,richHref,type RichAction,type RichDocument,type RichParagraph,type RichMark,type RichMarkKey,type RichMarkValue,type RichSpan,type RichRef,type RichRange,type RichSlice,type RichSplitCapture,type RichJoinCapture,type RichResolvedPoint} from './richTypes';

type Node={id:string;birthId:string;txId:string};
type Buffer={id:string;txId:string};
type Edge={id:string;buffer:string;fallback:RichRef|null;txId:string};
type Lineage={buffer:string;runId:string;ref:RichRef;before:boolean;txId:string};
type Place={id:string;node:string};
type Segment={id:string;node:string;buffer:string};
type Routing={spans:RichSpan[];edges:string[];node:string|null;segment:string;ordinal?:number;excludes?:RichSpan[]};
type Marking={spans:RichSpan[];mark:RichMark;enabled:boolean}|{spans:RichSpan[];mark:'link';href:string|null};
const markValue=(m:Marking):RichMarkValue|undefined=>m.mark==='link'?m.href===null?undefined:{type:'link',attrs:{href:m.href}}:m.enabled?{type:m.mark}:undefined;
type Write={root:string;key:string;value:LocalToolJson};
type Chosen={key:string;value:Routing;version?:RegisterVersion};
export interface RichView {data:RichDocument;bindings:RichBindings}
/** Private per-evaluation table support, never an activation or caller capability. */
export interface RichTableSupport {scalars:Map<string,RegisterVersion>;routes:RegisterVersion[]}
export interface RichTableWitness {unit:string;birthTx:string;ref:RichRef;route?:{version:RegisterVersion;node:string|null;segment:string}}
export interface RichPlan {
 nodes:Node[];buffers:Buffer[];edges:Edge[];lineages:Lineage[];
 nodePlaces:{at:string|null;place:Place}[];segments:{at:string|null;place:Segment}[];
 plain:Record<string,PlainPlan>;writes:Write[];view:RichView;changed:boolean;
 baseline?:RichView;
}
const copy=convergenceClone;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=():never=>{throw Error('local_tool_rich_invalid');};
const uuid=()=>crypto.randomUUID();
const unit=(buffer:string,runId:string,offset:number)=>JSON.stringify([buffer,runId,offset]);
function point(id:string):{buffer:string;runId:string;offset:number}{
 let p:unknown;try{p=JSON.parse(id);}catch{return fail();}
 if(!Array.isArray(p)||p.length!==3||typeof p[0]!=='string'||!p[0]||typeof p[1]!=='string'||!p[1]||!Number.isSafeInteger(p[2])||p[2]<0||unit(p[0],p[1],p[2])!==id)return fail();
 return{buffer:p[0],runId:p[1],offset:p[2]};
}
const plainPoint=(id:string)=>{const p=point(id);return JSON.stringify([p.runId,p.offset]);};
const refKey=(ref:RichRef)=>'unit'in ref?'u:'+ref.unit:'e:'+ref.edge;
const spans=(ids:readonly string[],readPoint:(id:string)=>ReturnType<typeof point>=point):RichSpan[]=>{const out:RichSpan[]=[];for(const id of ids){const p=readPoint(id),last=out.at(-1);if(last&&last.buffer===p.buffer&&last.runId===p.runId&&last.to===p.offset)last.to++;else out.push({buffer:p.buffer,runId:p.runId,from:p.offset,to:p.offset+1});}return out;};
const covers=(items:readonly RichSpan[],id:string,p=point(id))=>items.some(s=>s.buffer===p.buffer&&s.runId===p.runId&&s.from<=p.offset&&p.offset<s.to);
function insert<T extends {id:string}>(list:T[],after:string|null,value:T){const at=after===null?-1:list.findIndex(p=>p.id===after);if(after!==null&&at<0)return fail();list.splice(at+1,0,value);}
const marksEqual=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const lastMatching=<T>(items:readonly T[],predicate:(item:T)=>boolean):T|undefined=>{for(let i=items.length-1;i>=0;i--)if(predicate(items[i]))return items[i];return undefined;};

function routingOrdinal(value:Routing):number{
 if(!record(value))return fail();
 if(!Object.hasOwn(value,'ordinal'))return -1;
 if(typeof value.ordinal!=='number'||!Number.isSafeInteger(value.ordinal)||value.ordinal<0)return fail();
 return value.ordinal;
}

// Intrinsic eligibility belongs to one payload, before the unchanged TX comparator.
function routingEligible(value:Routing,refs:readonly RichRef[],decode=point):boolean {
 for(const ref of refs){
  if('unit'in ref){const p=decode(ref.unit);if(covers(value.spans,ref.unit,p))return true;if(value.excludes&&covers(value.excludes,ref.unit,p))return false;}
  else if(value.edges.includes(ref.edge))return true;
 }
 return false;
}
const spanOrder=(a:RichSpan,b:RichSpan)=>a.buffer<b.buffer?-1:a.buffer>b.buffer?1:a.runId<b.runId?-1:a.runId>b.runId?1:a.from-b.from;
/** Compact set only; positive spans retain their existing logical order. */
export function richExclusions(ids:ReadonlySet<string>,included:ReadonlySet<string>):RichSpan[]{
 const ordered=[...ids].filter(id=>!included.has(id)).map(id=>{const p=point(id);return{buffer:p.buffer,runId:p.runId,from:p.offset,to:p.offset+1};}).sort(spanOrder),out:RichSpan[]=[];
 for(const span of ordered){const last=out.at(-1);if(last&&last.buffer===span.buffer&&last.runId===span.runId&&last.to===span.from)last.to=span.to;else out.push(span);}
 return out;
}

/** Retained origin buffers and routing share the existing causal Registers. */
export class RichRuns {
 readonly prefix:string;readonly nodes:JsonMap<Node>;readonly buffers:JsonMap<Buffer>;readonly edges:JsonMap<Edge>;readonly lineages:JsonMap<Lineage>;
 readonly order:JsonArray<Place>;readonly segments:JsonArray<Segment>;
 readonly doc:Y.Doc;readonly field:string;readonly registers:Registers;readonly historical:boolean;readonly links:boolean;readonly markKinds:readonly RichMarkKey[];
 constructor(doc:Y.Doc,field:string,registers:Registers,historical=false,links=false){
  this.doc=doc;this.field=field;this.registers=registers;this.historical=historical;this.links=links;this.markKinds=links?RICH_MARK_KEYS:RICH_MARKS;
  this.prefix='rich3:'+JSON.stringify(field)+':';
  this.nodes=new JsonMap(doc.getMap(this.prefix+'nodes'));this.buffers=new JsonMap(doc.getMap(this.prefix+'buffers'));this.edges=new JsonMap(doc.getMap(this.prefix+'edges'));this.lineages=new JsonMap(doc.getMap(this.prefix+'lineage'));
  this.order=new JsonArray(doc.getArray(this.prefix+'order'));this.segments=new JsonArray(doc.getArray(this.prefix+'segments'));
 }
 root(name:string){return this.prefix+name;}
 hasNode(id:string){return[...this.nodes.values()].some(n=>n.id===id);}
 plain(buffer:string){return new PlainRuns(this.doc,JSON.stringify(['rich3',this.field,buffer]),this.registers);}
 draft(baseline?:RichView,support?:RichTableSupport){return new RichDraft(this,baseline,support);}
 private state(plan?:RichPlan,support?:RichTableSupport){
  const include=(r:{txId:string})=>!this.historical||this.registers.transactionAvailable(r.txId);
  // Syntax only, private to this scan; existence and routing remain separate checks.
  type ScanPoint=Readonly<ReturnType<typeof point>&{runKey:string}>;
  const points=new Map<string,ScanPoint>();
  const decodePoint=(id:string)=>{let parsed=points.get(id);if(!parsed){const value=point(id);parsed=Object.freeze({...value,runKey:JSON.stringify([value.buffer,value.runId])});points.set(id,parsed);}return parsed;};
  const nodes=new Map<string,Node>(),buffers=new Map([...this.buffers].filter(([,r])=>include(r))),edges=new Map([...this.edges].filter(([,r])=>include(r))),lineages=new Map([...this.lineages].filter(([,r])=>include(r)));
  for(const[key,node]of this.nodes){if(!include(node))continue;if(key!==node.birthId||nodes.has(node.id))throw Error('local_tool_rich_identity_collision');nodes.set(node.id,node);}
  for(const n of plan?.nodes??[])nodes.set(n.id,n);for(const b of plan?.buffers??[])buffers.set(b.id,b);for(const e of plan?.edges??[])edges.set(e.id,e);for(const l of plan?.lineages??[])lineages.set(JSON.stringify([l.buffer,l.runId]),l);
  // Historical order uses every retained reference born in the cut, including inactive
  // versions and genesis. Later physical placements/segments cannot reorder that cut.
  const retainedPlaces=this.historical?new Set(this.registers.entries(this.root('selected')).filter(v=>v.present).map(v=>v.value as string)):null;
  const retainedSegments=this.historical?new Set(this.registers.entries(this.root('routing')).filter(v=>v.present).map(v=>(v.value as unknown as Routing).segment)):null;
  const order=this.order.toArray().filter(p=>!retainedPlaces||retainedPlaces.has(p.id)),segments=this.segments.toArray().filter(p=>!retainedSegments||retainedSegments.has(p.id));
  for(const p of plan?.nodePlaces??[])insert(order,p.at,p.place);for(const p of plan?.segments??[])insert(segments,p.at,p.place);
  // Caches belong to this immutable state scan, never to a document or mutable draft.
  const valuesMemo=new Map<string,readonly RegisterVersion[]>(),stagedMemo=new Map<string,readonly Write[]>();
  const values=(name:string)=>{let cached=valuesMemo.get(name);if(!cached){cached=Object.freeze([...this.registers.candidates(this.root(name)),...(name==='routing'?(support?.routes??[]):[])]);valuesMemo.set(name,cached);}return cached;};
  const staged=(name:string)=>{let cached=stagedMemo.get(name);if(!cached){cached=Object.freeze((plan?.writes??[]).filter(w=>w.root===this.root(name)));stagedMemo.set(name,cached);}return cached;};
  // Retained entries preserve root/key order, including inactive and absent versions.
  type EntryIndex={byKey:Map<string,readonly RegisterVersion[]>;rank:Map<RegisterVersion,number>};
  const entryIndexes=new Map<string,EntryIndex>();
  const entryIndex=(name:string)=>{let index=entryIndexes.get(name);if(!index){const versions=this.registers.entries(this.root(name)),groups=new Map<string,RegisterVersion[]>();for(const version of versions){const group=groups.get(version.key)??[];group.push(version);groups.set(version.key,group);}index={byKey:new Map([...groups].map(([key,values])=>[key,Object.freeze(values)])),rank:new Map(versions.map((value,at)=>[value,at]))};entryIndexes.set(name,index);}return index;};
  const retained=(name:string,key:string)=>entryIndex(name).byKey.get(key)??[];
  const matchingRetained=(name:string,keys:Set<string>)=>{if(!keys.size)return[];const index=entryIndex(name),versions=[...keys].flatMap(key=>index.byKey.get(key)??[]);if(keys.size>1)versions.sort((a,b)=>index.rank.get(a)!-index.rank.get(b)!);return versions;};
  const baseline=plan?.baseline,baselineNodes=new Map((baseline?.bindings.nodes??[]).map(n=>[n.id,n])),baselineUnits=new Map((baseline?.bindings.nodes??[]).flatMap(n=>n.units.map(u=>[u.id,u] as const)));
  const scalar=(name:string,key:string)=>{const own=lastMatching(staged(name),w=>w.key===key);if(own)return own.value;if(baseline){if(name==='membership')return baselineNodes.has(key);if(name==='selected')return baselineNodes.get(key)?.placement;if(name==='edge')return baselineNodes.get(key)?.edge;}const current=this.registers.winner(this.root(name),key);return current?current.value:support?.scalars.get(JSON.stringify([name,key]))?.value;};
  const known=new Map<string,string>(),visible=new Set<string>(),physical=new Map<string,string[]>(),runSizes=new Map<string,number>(),duplicateRuns=new Set<string>();
  for(const b of buffers.values()){
   if(b.txId!=='@plan'&&!this.registers.transactionAvailable(b.txId))continue;
   const source=this.plain(b.id),prepared=plan?.plain[b.id],extra=prepared?.runs??[],all=[...source.allSpans(),...extra.map(r=>({runId:r.id,from:0,to:r.length}))];
   for(const span of all){const key=JSON.stringify([b.id,span.runId]);if(runSizes.has(key))duplicateRuns.add(key);runSizes.set(key,span.to-span.from);}
   const base=baseline?spans([...baselineUnits.keys()].filter(id=>decodePoint(id).buffer===b.id),decodePoint).map(({runId,from,to})=>({runId,from,to})):undefined;
   const{full,visible:shown}=source.retainedAndVisible(base,extra,prepared?.spans??[]),ids:string[]=[];
   let shownAt=0;
   for(const span of full.bindings){
    const buffer=b.id,runId=span.runId,runKey=JSON.stringify([buffer,runId]),syntax=typeof buffer==='string'&&!!buffer&&typeof runId==='string'&&!!runId;
    for(let offset=span.from;offset<span.to;offset++){
     const id=unit(buffer,runId,offset);if(!points.has(id)&&syntax&&Number.isSafeInteger(offset)&&offset>=0)points.set(id,Object.freeze({buffer,runId,offset:offset===0?0:offset,runKey}));known.set(id,full.text.charAt(ids.length));ids.push(id);
     const next=shown[shownAt];if(next&&next.runId===runId&&next.from<=offset&&offset<next.to){visible.add(id);if(offset+1===next.to)shownAt++;}
    }
   }
   physical.set(b.id,ids);
  }
  const lineage=(ref:RichRef):RichRef[]=>{
   const path:RichRef[]=[],seen=new Set<string>();let current:RichRef|null=ref;
   while(current){
    const key=refKey(current);if(seen.has(key))return fail();seen.add(key);path.push(current);
    if('unit'in current){if(!known.has(current.unit))throw Error('local_tool_rich_dependency_missing');const p=decodePoint(current.unit);current=lineages.get(p.runKey)?.ref??null;}
    else{const edge=edges.get(current.edge);if(!edge||edge.txId!=='@plan'&&!this.registers.transactionAvailable(edge.txId))throw Error('local_tool_rich_dependency_missing');current=edge.fallback;}
   }
   return path;
  };
  const eligible=(value:Routing,refs:RichRef[])=>routingEligible(value,refs,decodePoint);
  // Only eligible versions enter this reduction. Ordinals order one transaction;
  // causal precedence and UUID ties between transactions stay in Registers.
  const routingMaximum=(versions:RegisterVersion[])=>{
   const ordinals=new Map<string,number>();
   for(const v of versions){const ordinal=routingOrdinal(v.value as unknown as Routing),previous=ordinals.get(v.txId);if(previous===undefined||ordinal>previous)ordinals.set(v.txId,ordinal);}
   return this.registers.maximumCandidate(versions.filter(v=>routingOrdinal(v.value as unknown as Routing)===ordinals.get(v.txId)));
  };
  // A complete lineage is checked before consulting this local active context.
  // Retained snapshots never establish active home authority.
  let routingContext:{rules:{value:Routing;modern:boolean}[];directEdges:Set<string>}|undefined;
  const routeReferences=(refs:RichRef[])=>{
   if(!routingContext){
    const active=[...values('routing').filter(v=>v.present).map(v=>v.value as unknown as Routing),...staged('routing').map(w=>w.value as unknown as Routing)];
    const rules=active.map(value=>({value,modern:routingOrdinal(value)>=0}));
    routingContext={rules,directEdges:new Set(rules.flatMap(r=>r.value.edges))};
   }
   if(!routingContext.rules.some(r=>r.modern&&eligible(r.value,refs)))return refs;
   const at=refs.findIndex(ref=>'edge'in ref&&routingContext!.directEdges.has(ref.edge));
   return at<0?refs:refs.slice(0,at+1);
  };
  const resolveRoute=(ref:RichRef):Chosen|undefined=>{
   let refs:RichRef[];try{refs=lineage(ref);}catch(error){if(String(error).includes('dependency_missing'))return undefined;throw error;}const bounded=routeReferences(refs),own=lastMatching(staged('routing'),w=>eligible(w.value as unknown as Routing,bounded));if(own)return{key:own.key,value:own.value as unknown as Routing};
   if(baseline){const keys=new Set(bounded.flatMap(r=>'unit'in r&&baselineUnits.has(r.unit)?[baselineUnits.get(r.unit)!.route]:[]));const historical=routingMaximum(matchingRetained('routing',keys).filter(v=>eligible(v.value as unknown as Routing,refs)));if(historical)return{key:historical.key,value:historical.value as unknown as Routing,version:historical};}
   const winner=routingMaximum(values('routing').filter(v=>eligible(v.value as unknown as Routing,bounded)));
   return winner?{key:winner.key,value:winner.value as unknown as Routing,version:winner}:undefined;
  };
  // Units of one run have the same ancestor tail. Share its scalar choice only
  // when no retained/current/draft payload mentions this run by unit, and its
  // baseline witnesses are absent or complete with one identical route key.
  let sharing:{blocked:Set<string>;baseline:Map<string,{count:number;route:string;uniform:boolean}>;safe:boolean}|undefined;
  const shareRun=(key:string)=>{
   if(!sharing){
    const blocked=new Set<string>(),proof=new Map<string,{count:number;route:string;uniform:boolean}>();let safe=true;
    const inspect=(value:unknown)=>{
     if(!record(value)||!Array.isArray(value.spans)||Object.hasOwn(value,'excludes')&&!Array.isArray(value.excludes)){safe=false;return;}
     for(const span of[...value.spans,...(Array.isArray(value.excludes)?value.excludes:[])]){
      if(!record(span)||typeof span.buffer!=='string'||typeof span.runId!=='string'){safe=false;continue;}blocked.add(JSON.stringify([span.buffer,span.runId]));
     }
    };
    for(const versions of entryIndex('routing').byKey.values())for(const version of versions)if(version.present)inspect(version.value);
    for(const write of staged('routing'))inspect(write.value);
    if(baseline)for(const[id,u]of baselineUnits){const p=decodePoint(id),key=p.runKey,prior=proof.get(key);if(prior){prior.count++;prior.uniform&&=prior.route===u.route;}else proof.set(key,{count:1,route:u.route,uniform:true});}
    sharing={blocked,baseline:proof,safe};
   }
   if(!sharing.safe||sharing.blocked.has(key)||duplicateRuns.has(key))return false;
   const proof=sharing.baseline.get(key);return!proof||proof.uniform&&proof.count===runSizes.get(key);
  };
  // Scalar lookup result only, never a retained lineage array; misses are scoped too.
  const routes=new Map<string,Readonly<Chosen>|undefined>(),runRoutes=new Map<string,Readonly<Chosen>|undefined>();
  const route=(ref:RichRef):Readonly<Chosen>|undefined=>{
   if('unit'in ref&&known.has(ref.unit)){
    const p=decodePoint(ref.unit),key=p.runKey;
    if(shareRun(key)){if(runRoutes.has(key))return runRoutes.get(key);const chosen=resolveRoute(ref),value=chosen?Object.freeze(chosen):undefined;runRoutes.set(key,value);return value;}
   }
   const key=refKey(ref);if(routes.has(key))return routes.get(key);const chosen=resolveRoute(ref),value=chosen?Object.freeze(chosen):undefined;routes.set(key,value);return value;
  };
  const mark=(id:string,kind:RichMarkKey):{key:string;value:Marking}|undefined=>{
   const own=lastMatching(staged('marks'),w=>{const v=w.value as unknown as Marking;return v.mark===kind&&covers(v.spans,id,decodePoint(id));});if(own)return{key:own.key,value:own.value as unknown as Marking};
   if(baselineUnits.has(id)){const key=baselineUnits.get(id)!.marks[kind];if(!key)return undefined;const historical=retained('marks',key).find(v=>v.present);return historical?{key,value:historical.value as unknown as Marking}:undefined;}
   const winner=this.registers.maximumCandidate(values('marks').filter(v=>{const m=v.value as unknown as Marking;return m.mark===kind&&covers(m.spans,id,decodePoint(id));}));return winner?{key:winner.key,value:winner.value as unknown as Marking}:undefined;
  };
  // A buffer born at an empty split edge can inherit a segment of another origin on Undo.
  // Retained segment order, rather than map insertion order, orders those foreign origins.
  const bufferOrder=[...new Set(segments.map(p=>p.buffer))];
  const segmentIds=(segment:Segment)=>{
   const belongs=(id:string)=>route({unit:id})?.value.segment===segment.id;
   const out=(physical.get(segment.buffer)??[]).filter(belongs),groups=new Map<string,string[]>();
   for(const buffer of bufferOrder)if(buffer!==segment.buffer)for(const id of physical.get(buffer)??[])if(belongs(id)){const p=decodePoint(id),key=p.runKey;const group=groups.get(key)??[];group.push(id);groups.set(key,group);}
   const pending=[...groups];
   for(let pass=0;pending.length&&pass<=groups.size;pass++)for(const before of[true,false])for(let i=before?0:pending.length-1;before?i<pending.length:i>=0;before?i++:i--){
    const [key,ids]=pending[i],l=lineages.get(key);if((l?.before===true)!==before)continue;let ref=l?.ref??null;const seen=new Set<string>();while(ref&&'edge'in ref){if(seen.has(ref.edge))return fail();seen.add(ref.edge);ref=edges.get(ref.edge)?.fallback??null;}
    const anchor=ref&&'unit'in ref?out.indexOf(ref.unit):-1;
    if(anchor<0&&ref&&'unit'in ref&&belongs(ref.unit)&&pass<groups.size)continue;
    out.splice(anchor<0?out.length:anchor+(l?.before?0:1),0,...ids);pending.splice(i,1);if(before)i--;
   }
   if(pending.length)throw Error('local_tool_rich_dependency_missing');return out;
  };
  return{nodes,buffers,edges,lineages,order,segments,values,scalar,known,visible,physical,lineage,route,mark,segmentIds};
 }
 /** Probe current physical contributions before leaf membership filtering. */
 tableWitnesses():RichTableWitness[]{
  const s=this.state(),out:RichTableWitness[]=[];
  for(const id of s.visible){const p=point(id),run=this.plain(p.buffer).content.get(p.runId),lineage=s.lineages.get(JSON.stringify([p.buffer,p.runId]));if(!run||!lineage||!this.registers.transactionAvailable(run.txId))continue;const route=s.route({unit:id}),version=route?.version;out.push({unit:id,birthTx:run.txId,ref:lineage.ref,...(route&&version?{route:{version,node:route.value.node,segment:route.value.segment}}:{})});}
  return out;
 }
 tableHome(ref:RichRef,support?:RichTableSupport){const s=this.state(undefined,support),route=s.route(ref);if(!route)return undefined;const version=route.version;return version?{version,node:route.value.node,segment:route.value.segment}:undefined;}
 materialize(plan?:RichPlan,support?:RichTableSupport):RichView {
  const s=this.state(plan,support),content:RichParagraph[]=[],bindings:RichBindings={nodes:[]},emitted=new Set<string>();
  for(const p of s.order){
   if(s.scalar('membership',p.node)!==true||s.scalar('selected',p.node)!==p.id)continue;
   if(!s.nodes.has(p.node))return fail();const paragraph:RichParagraph={id:p.node,type:'paragraph',content:[]},bound={id:p.node,placement:p.id,edge:s.scalar('edge',p.node) as string,units:[] as RichUnitBinding[]};
   if(!s.edges.has(bound.edge))return fail();
   for(const segment of s.segments){if(segment.node!==p.node)continue;
    for(const id of s.segmentIds(segment)){
     if(!s.visible.has(id))continue;const routing=s.route({unit:id});if(!routing||routing.value.node!==p.node||routing.value.segment!==segment.id)continue;if(emitted.has(id))return fail();emitted.add(id);
     const signature:RichMarkValue[]=[],versions:Partial<Record<RichMarkKey,string>>={};for(const kind of this.markKinds){const m=s.mark(id,kind);if(m){versions[kind]=m.key;const tag=markValue(m.value);if(tag)signature.push(tag);}}
     const last=paragraph.content.at(-1),text=s.known.get(id)!;
     if(last&&marksEqual(last.marks??[],signature))last.text+=text;else paragraph.content.push({type:'text',text,...(signature.length?{marks:signature}:{})});
     bound.units.push({id,route:routing.key,segment:segment.id,marks:versions});
    }
   }
   content.push(paragraph);bindings.nodes.push(bound);
  }
  return{data:{type:'doc',content},bindings};
 }
 range(identity:LocalToolConvergenceIdentity,nodeId:string,from:number,to:number,affinity:'left'|'right'='right',admitted?:RichView):RichRange {
  const view=admitted??this.materialize(),node=view.bindings.nodes.find(n=>n.id===nodeId);if(!node||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||from>to||to>node.units.length||!['left','right'].includes(affinity))return fail();
  return{format:'writers-hoard-rich-range/1',identity:copy(identity),field:this.field,nodeId,left:node.units[from-1]?.id??null,right:node.units[from]?.id??null,affinity,edge:node.edge,deleteIds:node.units.slice(from,to).map(u=>u.id),frontier:this.registers.frontier()};
 }
 resolvePoint(range:RichRange,identity:LocalToolConvergenceIdentity,admitted?:RichView):RichResolvedPoint {
  this.assertRange(range,identity);if(range.deleteIds.length)throw Error('local_tool_rich_point_invalid');
  const s=this.state(),view=admitted??this.materialize();
  const refs:RichRef[]=range.affinity==='left'?[...(range.left?[{unit:range.left}]:[]),...(range.right?[{unit:range.right}]:[]),{edge:range.edge}]:[...(range.right?[{unit:range.right}]:[]),...(range.left?[{unit:range.left}]:[]),{edge:range.edge}];
  for(const ref of refs){
   const route=s.route(ref);if(!route?.value.node)continue;const bound=view.bindings.nodes.find(n=>n.id===route.value.node);if(!bound)continue;
   const visible=new Map(bound.units.map((u,i)=>[u.id,i]));
   if('unit'in ref&&visible.has(ref.unit))return{nodeId:bound.id,offset:visible.get(ref.unit)!+(ref.unit===range.left?1:0),detached:false};
   const segment=s.segments.find(p=>p.id===route.value.segment&&p.node===bound.id);if(!segment)continue;
   const retained=s.segmentIds(segment),target='unit'in ref?ref.unit:null;
   let cut=target?retained.indexOf(target):-1;
   if(cut>=0&&target===range.left)cut++;
   // An empty split edge retains its original gap through its fallback, including Undo.
   if(cut<0&&'edge'in ref){
    const lineage=s.lineage(ref),at=lineage.findIndex(r=>'unit'in r&&retained.includes(r.unit)),ancestor=lineage[at],parent=lineage[at-1];
    if(ancestor&&'unit'in ancestor){
     let after=range.affinity==='left';
     if(parent&&'edge'in parent){const edge=s.edges.get(parent.edge)!;after=this.registers.atFrontier([edge.txId],registers=>{const birth=new RichRuns(this.doc,this.field,registers,true,this.links).state(),home=birth.route({edge:edge.id})?.value.node,anchor=birth.route(ancestor)?.value.node;return home!==anchor;});}
     cut=retained.indexOf(ancestor.unit)+(after?1:0);
    }
   }
   if('edge'in ref){const descendants=retained.flatMap((id,i)=>s.lineage({unit:id}).some(r=>'edge'in r&&r.edge===ref.edge)?[i]:[]);if(descendants.length)cut=range.affinity==='left'?descendants.at(-1)!+1:descendants[0];}
   if(cut<0)cut=range.affinity==='left'?retained.length:0;
   const preceding=new Set(retained.slice(0,cut));let offset=0;
   for(const seg of s.segments){if(seg.node!==bound.id)continue;if(seg.id===segment.id){offset+=bound.units.filter(u=>u.segment===seg.id&&preceding.has(u.id)).length;break;}offset+=bound.units.filter(u=>u.segment===seg.id).length;}
   return{nodeId:bound.id,offset,detached:false};
  }
  return{detached:true};
 }
 splitCapture(identity:LocalToolConvergenceIdentity,nodeId:string,at:number,affinity:'left'|'right'='right',admitted?:RichView):RichSplitCapture {
  const view=admitted??this.materialize(),node=view.bindings.nodes.find(n=>n.id===nodeId);if(!node)return fail();const range=this.range(identity,nodeId,at,node.units.length,affinity,view);
  const all=this.retainedUnits(nodeId,admitted),start=range.right?all.findIndex(u=>u.id===range.right):range.left?all.findIndex(u=>u.id===range.left)+1:0;
  return{format:'writers-hoard-rich-split/1',range,suffix:this.slices(all.slice(start)),edges:[]};
 }
 orderRouting(targets:readonly {ids:string[];node:string|null;segment:string}[],plan:RichPlan):{ids:string[];node:string|null;segment:string}[]{
  const s=this.state(plan),groups=new Map<string,{depth:number;ids:string[];node:string|null;segment:string}>();
  for(const target of targets)for(const id of target.ids){
   if(!s.known.has(id))throw Error('local_tool_rich_dependency_missing');
   const depth=s.lineage({unit:id}).length,{node,segment}=target,key=JSON.stringify([depth,node,segment]);
   const group=groups.get(key)??{depth,ids:[],node,segment};group.ids.push(id);groups.set(key,group);
  }
  // Order only real moved fragments; no preservation versions are emitted.
  return[...groups.values()].sort((a,b)=>a.depth-b.depth).map(({ids,node,segment})=>({ids,node,segment}));
 }
 private slices(units:readonly RichUnitBinding[]):RichSlice[]{const out:RichSlice[]=[];for(const u of units){const p=point(u.id),last=out.at(-1);if(last&&last.buffer===p.buffer&&last.segment===u.segment)last.ids.push(u.id);else out.push({buffer:p.buffer,ids:[u.id],segment:u.segment});}return out;}
 private retainedUnits(nodeId:string,baseline?:RichView):RichUnitBinding[]{
  const s=this.state(baseline?{nodes:[],buffers:[],edges:[],lineages:[],nodePlaces:[],segments:[],plain:{},writes:[],view:baseline,baseline,changed:false}:undefined),units:RichUnitBinding[]=[];for(const seg of s.segments)if(seg.node===nodeId)for(const id of s.segmentIds(seg)){const r=s.route({unit:id});if(r?.value.node===nodeId&&r.value.segment===seg.id)units.push({id,segment:seg.id,route:r.key,marks:{}});}return units;
 }
 joinCapture(identity:LocalToolConvergenceIdentity,leftNodeId:string,rightNodeId:string,admitted?:RichView):RichJoinCapture {
  const view=admitted??this.materialize(),left=view.bindings.nodes.findIndex(n=>n.id===leftNodeId),right=view.bindings.nodes[left+1];if(left<0||right?.id!==rightNodeId)return fail();
  const s=this.state(),units=this.retainedUnits(rightNodeId,admitted);
  const edges=[...s.edges.keys()].filter(id=>s.route({edge:id})?.value.node===rightNodeId).sort();
  return{format:'writers-hoard-rich-join/1',identity:copy(identity),field:this.field,leftNodeId,rightNodeId,slices:this.slices(units),edges,frontier:this.registers.frontier()};
 }
 assertRange(range:RichRange,identity:LocalToolConvergenceIdentity){
  if(!range||range.format!=='writers-hoard-rich-range/1'||range.field!==this.field||!['left','right'].includes(range.affinity)||!Array.isArray(range.deleteIds)||new Set(range.deleteIds).size!==range.deleteIds.length)return fail();assertConvergenceIdentity(range.identity,identity);
  const s=this.state();if(!s.nodes.has(range.nodeId)||!s.edges.has(range.edge))return fail();for(const id of [...range.deleteIds,...(range.left?[range.left]:[]),...(range.right?[range.right]:[])])if(!s.known.has(id))return fail();
 }
 checkBindings(view:RichView):void {this.bindingValidator()(view);}
 /** One immutable synchronous scan, shared across retained snapshot checks only. */
 bindingValidator():(view:RichView)=>void {
  type Verified={node:string;route:string;segment:string;keys:readonly (string|undefined)[];marks:readonly RichMarkValue[];text:string};
  let scan:ReturnType<RichRuns['state']>|undefined;
  const routing=new Map<string,Routing>(),marking=new Map<string,Marking>(),verified=new Map<string,Verified[]>();
  return view=>{
   validateRichDocument(view.data,this.links);const fresh=!scan,s=scan??=this.state(),seen=new Set<string>();
   if(fresh){
    // Preserve candidate-first, then retained-entry priority, including inactive versions.
    for(const v of [...this.registers.candidates(this.root('routing')),...this.registers.entries(this.root('routing'))])if(v.present&&!routing.has(v.key))routing.set(v.key,v.value as unknown as Routing);
    for(const v of [...this.registers.candidates(this.root('marks')),...this.registers.entries(this.root('marks'))])if(v.present&&!marking.has(v.key))marking.set(v.key,v.value as unknown as Marking);
   }
   if(view.bindings.nodes.length!==view.data.content.length)return fail();
   for(let i=0;i<view.bindings.nodes.length;i++){
    const b=view.bindings.nodes[i],p=view.data.content[i];if(p.id!==b.id||!s.nodes.has(b.id)||!s.order.some(v=>v.id===b.placement&&v.node===b.id)||!s.edges.has(b.edge))return fail();
    const actual:RichParagraph={id:p.id,type:'paragraph',content:[]};
    for(const u of b.units){if(!this.links&&Object.hasOwn(u.marks,'link'))return fail();if(seen.has(u.id)||!s.known.has(u.id))return fail();seen.add(u.id);
     const known=verified.get(u.id)??[];
     let unit=known.find(v=>v.node===b.id&&v.route===u.route&&v.segment===u.segment&&this.markKinds.every((kind,at)=>v.keys[at]===u.marks[kind]));
     if(!unit){
      const route=routing.get(u.route);
      if(!route||route.node!==b.id||route.segment!==u.segment||!s.segments.some(v=>v.id===u.segment&&v.node===b.id)||!routingEligible(route,s.lineage({unit:u.id})))return fail();
      const marks:RichMarkValue[]=[];for(const kind of this.markKinds){const key=u.marks[kind];if(!key)continue;const m=marking.get(key);if(!m||m.mark!==kind||!covers(m.spans,u.id))return fail();const tag=markValue(m);if(tag)marks.push(tag);}
      unit=Object.freeze({node:b.id,route:u.route,segment:u.segment,keys:Object.freeze(this.markKinds.map(kind=>u.marks[kind])),marks:Object.freeze(marks),text:s.known.get(u.id)!});known.push(unit);verified.set(u.id,known);
     }
     const tags=unit.marks,last=actual.content.at(-1);if(last&&marksEqual(last.marks??[],tags))last.text+=unit.text;else actual.content.push({type:'text',text:unit.text,...(tags.length?{marks:[...tags]}:{})});
    }
    if(convergenceCanonical(actual)!==convergenceCanonical(p))return fail();
   }
  };
 }
 validate():void {
  // Validate inactive retained metadata before visibility, pending or fallback.
  let missingRoutingDependency=false;
  for(const v of this.registers.entries(this.root('routing')))if(v.present){
   const r=v.value as unknown as Routing,ordinal=routingOrdinal(r);
   if(!Object.hasOwn(r,'excludes'))continue;
   if(ordinal<0||!Array.isArray(r.excludes)||!r.excludes.length||!Array.isArray(r.spans))return fail();
   // Validate the entire mask and its bounds before any unit expansion/state scan.
   let previous:RichSpan|undefined;
   for(const span of r.excludes){
    if(!record(span)||Object.keys(span).length!==4||typeof span.buffer!=='string'||!span.buffer||typeof span.runId!=='string'||!span.runId||!Number.isSafeInteger(span.from)||!Number.isSafeInteger(span.to)||span.from<0||span.from>=span.to)return fail();
    if(previous&&(spanOrder(previous,span)>=0||previous.buffer===span.buffer&&previous.runId===span.runId&&previous.to>=span.from))return fail();previous=span;
    for(const included of r.spans){
     if(!record(included)||typeof included.buffer!=='string'||typeof included.runId!=='string'||!Number.isSafeInteger(included.from)||!Number.isSafeInteger(included.to)||included.from<0||included.from>=included.to)return fail();
     if(included.buffer===span.buffer&&included.runId===span.runId&&included.from<span.to&&span.from<included.to)return fail();
    }
    const buffer=this.buffers.get(span.buffer),run=buffer?this.plain(span.buffer).content.get(span.runId):undefined;
    if(!buffer||!run){missingRoutingDependency=true;continue;}
    if(!Number.isSafeInteger(run.length)||run.length<0||span.to>run.length)return fail();
    if(!this.registers.transactionAvailable(buffer.txId)||!this.registers.transactionAvailable(run.txId))missingRoutingDependency=true;
   }
  }
  // Missing dependencies are reported after all retained payloads are checked.
  const s=this.state();
  // Validate every retained mark payload before considering missing dependencies or visibility.
  let missingMarkDependency=false;
  for(const version of this.registers.entries(this.root('marks'))){
   const value=version.value as unknown;
   if(!version.present||!record(value)||Object.keys(value).length!==3||!Object.hasOwn(value,'spans')||!Object.hasOwn(value,'mark')||(value.mark==='link'? !this.links||!Object.hasOwn(value,'href')||value.href!==null&&!richHref(value.href):!Object.hasOwn(value,'enabled')||!RICH_MARKS.includes(value.mark as RichMark)||typeof value.enabled!=='boolean')||!Array.isArray(value.spans)||!value.spans.length)return fail();
   const seen=new Map<string,{from:number;to:number}[]>();
   for(const span of value.spans){
    if(!record(span)||Object.keys(span).length!==4||typeof span.buffer!=='string'||!span.buffer||typeof span.runId!=='string'||!span.runId||!Number.isSafeInteger(span.from)||!Number.isSafeInteger(span.to)||Number(span.from)<0||Number(span.from)>=Number(span.to))return fail();
    const from=Number(span.from),to=Number(span.to),key=JSON.stringify([span.buffer,span.runId]),previous=seen.get(key)??[];if(previous.some(p=>from<p.to&&to>p.from))return fail();previous.push({from,to});seen.set(key,previous);
    if(!s.buffers.has(span.buffer)){missingMarkDependency=true;continue;}const run=this.plain(span.buffer).content.get(span.runId);
    if(!run){missingMarkDependency=true;continue;}if(to>run.length)return fail();
    if(!this.registers.transactionAvailable(run.txId))missingMarkDependency=true;
    for(let offset=from;offset<to;offset++)if(!s.known.has(unit(span.buffer,span.runId,offset)))missingMarkDependency=true;
   }
  }


  for(const b of s.buffers.values())this.plain(b.id).validate();for(const [id,n]of s.nodes)if(id!==n.id||typeof n.txId!=='string')return fail();
  for(const [id,b]of s.buffers)if(id!==b.id||typeof b.txId!=='string')return fail();
  for(const [key,l]of s.lineages)if(key!==JSON.stringify([l.buffer,l.runId])||typeof l.before!=='boolean'||typeof l.txId!=='string'||!s.buffers.has(l.buffer))return fail();
  for(const [id,e]of s.edges){if(id!==e.id||typeof e.txId!=='string')return fail();s.lineage({edge:id});}
  for(const id of s.known.keys()){const p=point(id);if(!s.lineages.has(JSON.stringify([p.buffer,p.runId])))throw Error('local_tool_rich_dependency_missing');s.lineage({unit:id});}
  for(const v of this.registers.entries(this.root('routing')))if(v.present){const r=v.value as unknown as Routing;if(!Array.isArray(r.spans)||!Array.isArray(r.edges)||r.node!==null&&!s.nodes.has(r.node)||r.node!==null&&!s.segments.some(p=>p.id===r.segment&&p.node===r.node))return fail();for(const span of r.spans){if(!Number.isSafeInteger(span.from)||!Number.isSafeInteger(span.to)||span.from<0||span.from>=span.to)return fail();for(let at=span.from;at<span.to;at++)if(!s.known.has(unit(span.buffer,span.runId,at)))throw Error('local_tool_rich_dependency_missing');}for(const edge of r.edges)s.lineage({edge});}
  if(missingMarkDependency||missingRoutingDependency)throw Error('local_tool_rich_dependency_missing');
 }
 pending():boolean {try{this.validate();for(const b of this.buffers.values())if(!this.registers.transactionAvailable(b.txId)||this.plain(b.id).pending())return true;for(const record of [...this.nodes.values(),...this.edges.values(),...this.lineages.values()])if(!this.registers.transactionAvailable(record.txId))return true;return false;}catch(error){if(String(error).includes('dependency_missing'))return true;throw error;}}
 commit(plan:RichPlan):void {
  const txId=this.registers.currentTransactionId();for(const n of plan.nodes)this.nodes.set(n.birthId,{...n,txId});for(const b of plan.buffers)this.buffers.set(b.id,{...b,txId});for(const e of plan.edges)this.edges.set(e.id,{...e,txId});for(const l of plan.lineages)this.lineages.set(JSON.stringify([l.buffer,l.runId]),{...l,txId});
  for(const p of plan.nodePlaces){const list=this.order.toArray(),at=p.at===null?-1:list.findIndex(v=>v.id===p.at);if(p.at!==null&&at<0)return fail();this.order.insert(at+1,[p.place]);}
  for(const p of plan.segments){const list=this.segments.toArray(),at=p.at===null?-1:list.findIndex(v=>v.id===p.at);if(p.at!==null&&at<0)return fail();this.segments.insert(at+1,[p.place]);}
  for(const [buffer,plain]of Object.entries(plan.plain))this.plain(buffer).commit(plain);for(const w of plan.writes)this.registers.write(w.root,w.key,true,w.value);
 }
}

/** One disposable overlay; allocating a plan never writes roots or a receipt. */
export class RichDraft {
 readonly plan:RichPlan={nodes:[],buffers:[],edges:[],lineages:[],nodePlaces:[],segments:[],plain:{},writes:[],view:{data:{type:'doc',content:[]},bindings:{nodes:[]}},changed:false};
 private readonly drafts=new Map<string,PlainDraft>();
 readonly source:RichRuns;
 private readonly tableSupport:RichTableSupport|undefined;
 constructor(source:RichRuns,baseline?:RichView,support?:RichTableSupport){this.source=source;this.tableSupport=support;if(baseline)this.plan.baseline=copy(baseline);}
 private write(name:string,key:string,value:unknown){this.plan.writes.push({root:this.source.root(name),key,value:copy(value) as LocalToolJson});this.plan.changed=true;}
 private preparePlain(){for(const [id,draft]of this.drafts){const plan=draft.finish();this.plan.plain[id]=plan;if(plan.changed)this.plan.changed=true;}}
 private refresh(){this.preparePlain();this.plan.view=this.source.materialize(this.plan,this.tableSupport);return this.plan.view;}
 private text(buffer:string){let d=this.drafts.get(buffer);if(!d){const p=this.source.plain(buffer);d=p.draft(p.materialize());this.drafts.set(buffer,d);}return d;}
 private segment(node:string,buffer:string,after:string|null){const id=uuid();this.plan.segments.push({at:after,place:{id,node,buffer}});return id;}
 private lastSegment(node:string){const own=this.plan.segments.filter(v=>v.place.node===node).at(-1)?.place.id;return own??this.source.segments.toArray().filter(v=>v.node===node).at(-1)?.id??null;}
 private route(ids:string[],edges:string[],node:string|null,segment:string,excludes?:readonly RichSpan[]){this.write('routing',uuid(),{spans:spans(ids),edges,node,segment,ordinal:this.plan.writes.length,...(excludes?.length?{excludes}: {})});}
 private place(node:string,afterId:string|null){
  const view=this.refresh(),after=afterId===null?null:view.bindings.nodes.find(v=>v.id===afterId)?.placement;if(after===undefined)return fail();const id=uuid();this.plan.nodePlaces.push({at:after,place:{id,node}});this.write('selected',node,id);
 }
 private buffer(node:string,fallback:RichRef|null,deferRoute=false){const buffer=uuid(),edge=uuid();this.plan.buffers.push({id:buffer,txId:'@plan'});this.plan.edges.push({id:edge,buffer,fallback,txId:'@plan'});const segment=this.segment(node,buffer,this.lastSegment(node));if(!deferRoute)this.route([], [edge],node,segment);this.write('edge',node,edge);return{buffer,edge,segment};}
 private insert(node:string,afterId:string|null,text:string,marks:RichMark[]=[],fallback:RichRef|null=null,deferHomeRoute=false){
  if(this.source.hasNode(node)||this.plan.nodes.some(n=>n.id===node))return fail();this.plan.nodes.push({id:node,birthId:uuid(),txId:'@plan'});const b=this.buffer(node,fallback,deferHomeRoute);this.write('membership',node,true);this.place(node,afterId);this.append(b.buffer,null,text,{edge:b.edge},marks);return b;
 }
 private append(buffer:string,after:string|null,text:string,ref:RichRef,marks:RichMark[],before=false,link?:{href:string}){
  if(!text)return;const draft=this.text(buffer),previous=new Set(draft.insertedRuns().map(r=>r.id));draft.splice({afterPlacementId:after,deleteIds:[]},text);const added=draft.insertedRuns().filter(r=>!previous.has(r.id));
  for(const r of added){this.plan.lineages.push({buffer,runId:r.id,ref,before,txId:'@plan'});for(const mark of marks)this.write('marks',uuid(),{spans:[{buffer,runId:r.id,from:0,to:r.length}],mark,enabled:true});if(link)this.write('marks',uuid(),{spans:[{buffer,runId:r.id,from:0,to:r.length}],mark:'link',href:link.href});}this.preparePlain();
 }
 apply(action:RichAction,identity:LocalToolConvergenceIdentity,excludes?:readonly RichSpan[]):void {
  if(action.field!==this.source.field)return fail();
  if(action.type==='rich-insert-paragraph'){const link=action.link===undefined?undefined:this.link(action.link);if(typeof action.id!=='string'||!action.id||typeof action.text!=='string'||action.marks?.some(m=>!RICH_MARKS.includes(m)))return fail();const born=this.insert(action.id,action.afterId,'',action.marks);this.append(born.buffer,null,action.text,{edge:born.edge},action.marks??[],false,link);}
  else if(action.type==='rich-delete-paragraph'){if(!this.refresh().bindings.nodes.some(n=>n.id===action.id))return fail();this.write('membership',action.id,false);}
  else if(action.type==='rich-move-paragraph'){if(action.afterId===action.id||!this.refresh().bindings.nodes.some(n=>n.id===action.id))return fail();this.place(action.id,action.afterId);}
  else if(action.type==='rich-text-splice'||action.type==='rich-mark'||action.type==='rich-link'){
   this.source.assertRange(action.range,identity);if(action.nodeId!==action.range.nodeId)return fail();
   if(action.type==='rich-link'){if(!this.source.links||action.href!==null&&typeof action.href!=='string')return fail();const href=action.href===null?null:normalizeEditorLinkHref(action.href);if(action.href!==null&&href===null)return fail();if(action.range.deleteIds.length)this.write('marks',uuid(),{spans:spans(action.range.deleteIds),mark:'link',href});}
   else if(action.type==='rich-mark'){if(!RICH_MARKS.includes(action.mark)||typeof action.enabled!=='boolean')return fail();if(action.range.deleteIds.length)this.write('marks',uuid(),{spans:spans(action.range.deleteIds),mark:action.mark,enabled:action.enabled});}
   else{
    const link=action.link===undefined?undefined:this.link(action.link);
    if(typeof action.text!=='string'||action.marks?.some(m=>!RICH_MARKS.includes(m)))return fail();
    for(const s of spans(action.range.deleteIds)){const d=this.text(s.buffer);d.splice({afterPlacementId:null,deleteIds:Array.from({length:s.to-s.from},(_,i)=>JSON.stringify([s.runId,s.from+i]))},'');}
    const left=action.range.left,right=action.range.right,preferred=action.range.affinity==='right'?right??left:left??right,ref:RichRef=preferred?{unit:preferred}:{edge:action.range.edge};
    const buffer=left?point(left).buffer:right?point(right).buffer:this.plan.edges.find(e=>e.id===action.range.edge)?.buffer??this.source.edges.get(action.range.edge)?.buffer;
    if(!buffer)return fail();this.append(buffer,left&&point(left).buffer===buffer?plainPoint(left):null,action.text,ref,action.marks??[],preferred!==null&&preferred===right,link);
   }
  }else if(action.type==='rich-split'){
   const c=action.capture;this.source.assertRange(c.range,identity);if(c.format!=='writers-hoard-rich-split/1'||!excludes)return fail();
   const r=c.range,ref:RichRef=r.right?{unit:r.right}:r.left?{unit:r.left}:{edge:r.edge};const born=this.insert(action.newNodeId,r.nodeId,'',[],ref,true);
   const moved:{ids:string[];node:string|null;segment:string}[]=[];let previous=born.segment;for(const slice of c.suffix){const segment=this.segment(action.newNodeId,slice.buffer,previous);previous=segment;moved.push({ids:slice.ids,node:action.newNodeId,segment});}
   for(const value of this.source.orderRouting(moved,this.plan))this.route(value.ids,[],value.node,value.segment,excludes);
   // No observed unit can descend from this fresh edge. Keep its authority over
   // its captured fallback, including the first input in an empty right node.
   this.route([],[born.edge],action.newNodeId,born.segment);
   // Only the captured split edge changes side; existing end edges remain inherited through their origins.
   // The original paragraph's home edge must not move: it is an ancestor of its prefix too.
   // The new paragraph owns a fresh edge whose fallback retains the captured split gap.
  }else if(action.type==='rich-join'){
   const c=action.capture;if(c.format!=='writers-hoard-rich-join/1'||!excludes||c.field!==this.source.field||c.leftNodeId===c.rightNodeId)return fail();assertConvergenceIdentity(c.identity,identity);
   const known=this.refresh().bindings.nodes;if(!known.some(n=>n.id===c.leftNodeId)||!known.some(n=>n.id===c.rightNodeId))return fail();let previous=this.lastSegment(c.leftNodeId);
   const routes:{ids:string[];node:string|null;segment:string}[]=[];for(const slice of c.slices){const segment=this.segment(c.leftNodeId,slice.buffer,previous);previous=segment;routes.push({ids:slice.ids,node:c.leftNodeId,segment});}
   // Home edges are fallback for unobserved descendants, not a later override of observed origins.
   if(previous)this.route([],c.edges,c.leftNodeId,previous,excludes);
   for(const value of this.source.orderRouting(routes,this.plan))this.route(value.ids,[],value.node,value.segment,excludes);this.write('membership',c.rightNodeId,false);
  }
  this.refresh();
 }
 private link(value:unknown):{href:string}{if(!this.source.links||!record(value)||Object.keys(value).length!==1||typeof value.href!=='string')return fail();const href=normalizeEditorLinkHref(value.href);if(!href)return fail();return{href};}
 private appendParagraphContent(buffer:string,edge:string,content:RichParagraph['content']){
  this.append(buffer,null,content.map(text=>text.text).join(''),{edge},[]);
  const run=this.text(buffer).finish().runs[0];let offset=0;
  for(const text of content){
   for(const mark of text.marks??[])if(run)this.write('marks',uuid(),{spans:[{buffer,runId:run.id,from:offset,to:offset+text.text.length}],...(mark.type==='link'?{mark:'link',href:mark.attrs.href}:{mark:mark.type,enabled:true})});
   offset+=text.text.length;
  }
 }
 insertParagraphs(paragraphs:RichParagraph[]){
  validateRichDocument({type:'doc',content:paragraphs},this.source.links);
  let previous=this.refresh().bindings.nodes.at(-1)?.id??null;
  for(const paragraph of paragraphs){
   const {buffer,edge}=this.insert(paragraph.id,previous,'');
   this.appendParagraphContent(buffer,edge,paragraph.content);previous=paragraph.id;
  }
 }
 replace(value:RichDocument|undefined):void {
  if(value!==undefined)validateRichDocument(value,this.source.links);
  for(const buffer of new Set([...this.source.buffers.keys(),...this.plan.buffers.map(b=>b.id)])){const p=this.source.plain(buffer);this.text(buffer).clear();const all=p.materialize(p.allSpans());const ids=all.bindings.flatMap(s=>Array.from({length:s.to-s.from},(_,i)=>unit(buffer,s.runId,s.from+i)));if(ids.length)this.route(ids,[],null,'');}
  for(const node of new Set([...this.source.nodes.values()].map(n=>n.id).concat(this.plan.nodes.map(n=>n.id))))this.write('membership',node,false);
  for(const edge of new Set([...this.source.edges.keys(),...this.plan.edges.map(e=>e.id)]))this.route([],[edge],null,'');
  let previous:string|null=null;
  for(const p of value?.content??[]){
   if(!this.source.hasNode(p.id)&&!this.plan.nodes.some(n=>n.id===p.id)){this.insert(p.id,previous,'');}
   else{this.write('membership',p.id,true);this.place(p.id,previous);this.buffer(p.id,null);}
   const own=this.plan.buffers.at(-1)!,edge=this.plan.edges.at(-1)!.id;
   this.appendParagraphContent(own.id,edge,p.content);
   previous=p.id;
  }
  this.refresh();if(value!==undefined&&convergenceCanonical(this.plan.view.data)!==convergenceCanonical(value))return fail();
 }
 finish():RichPlan{this.refresh();return copy(this.plan);}
}
