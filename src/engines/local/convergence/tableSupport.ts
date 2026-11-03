import type {RichBlocks,StructuralNode} from './blocks';
import {richBlockLeaf,validateRichBlockDocument,type RichBlockDocument,type RichBlockBindings,type RichBlockBinding} from './blockFormat';
import type {RichRuns,RichTableSupport,RichView} from './richRuns';
import type {RichRef} from './richTypes';
import type {RegisterVersion} from './registers';
import {convergenceClone} from './format';
export interface HistoricalTableField {
 data:RichBlockDocument;bindings:RichBlockBindings;rich:RichView;
 home:(ref:RichRef)=>ReturnType<RichRuns['tableHome']>;
 scalar:(name:string,node:string)=>RegisterVersion|undefined;
}
export interface TableSupport {nodes:Map<string,StructuralNode>;rich:RichTableSupport}
/** Fresh synchronous closure. A snapshot or caller DTO never supplies authority. */
export function deriveTableSupport(source:RichBlocks,rich:RichRuns,read:(frontier:string[])=>HistoricalTableField):TableSupport {
 const result:TableSupport={nodes:new Map(),rich:{scalars:new Map(),routes:[]}},registers=source.registers;
 if(!registers.entries(source.root('kind')).some(v=>v.present&&v.value==='table'&&!registers.winner(source.root('membership'),v.key)))return result;
 const visited=new Set<string>();
 const select=(root:string,key:string,id:string,retired:string):RegisterVersion|undefined=>{
  const active=registers.winner(root,key);if(active)return active.present?active:undefined;
  const old=registers.versions.get(id),off=old&&registers.activation(id);if(!old?.present||old.root!==root||old.key!==key||off?.enabled!==false||off.txId!==retired||!registers.transactionAvailable(retired))return undefined;
  const parents=registers.transactionParents(retired);if(!parents?.length)return undefined;
  return registers.atFrontier(parents,prior=>prior.winner(root,key)?.id===id)?old:undefined;
 };
 const contribute=(txId:string,node:string|null,ref?:RichRef,tableOnly=false)=>{
  const key=JSON.stringify([txId,node,ref??null,tableOnly]);if(visited.has(key))return;visited.add(key);
  const parents=registers.transactionParents(txId);if(!parents?.length||!registers.transactionAvailable(txId))return;
  const prior=read(parents);validateRichBlockDocument(prior.data,source.links,true);
  const home=node===null&&ref?prior.home(ref):undefined,target=node??home?.node;if(!target)return;
  const byId=new Map(prior.data.blocks.map(b=>[b.id,b]));let table=byId.get(target);if(tableOnly&&table?.type!=='table')return;const seen=new Set<string>();
  while(table&&table.type!=='table'){if(seen.has(table.id))return;seen.add(table.id);table=table.parentId===null?undefined:byId.get(table.parentId);}if(!table)return;
  const tableBinding=prior.bindings.nodes.find(b=>b.id===table!.id);if(!tableBinding)return;const membership=registers.winner(source.root('membership'),table.id);if(membership)return;
  const off=registers.activation(tableBinding.membershipVersionId);if(off?.enabled!==false||!registers.transactionAvailable(off.txId))return;const retired=off.txId;
  const ids=new Set([table.id]);let changed=true;while(changed){changed=false;for(const b of prior.data.blocks)if(b.parentId!==null&&ids.has(b.parentId)&&!ids.has(b.id)){ids.add(b.id);changed=true;}}
  const nodes=new Map<string,StructuralNode>(),scalars=new Map<string,RegisterVersion>(),routes:RegisterVersion[]=[];
  for(const block of prior.data.blocks){if(!ids.has(block.id))continue;const bound=prior.bindings.nodes.find(b=>b.id===block.id);if(!bound)return;
   const values={} as Record<'kind'|'attrs'|'membership'|'placement',RegisterVersion>;let complete=true;
   for(const name of ['kind','attrs','membership','placement']as const){const value=select(source.root(name),block.id,bound[`${name}VersionId`],retired);if(!value){complete=false;break;}values[name]=value;}
   if(!complete){if(richBlockLeaf(block.type))continue;return;}if(values.membership.value!==true){if(richBlockLeaf(block.type))continue;return;}
   const binding:RichBlockBinding={id:block.id,kindVersionId:values.kind.id,attrsVersionId:values.attrs.id,membershipVersionId:values.membership.id,placementVersionId:values.placement.id};
   nodes.set(block.id,{block:{id:block.id,type:values.kind.value as typeof block.type,attrs:convergenceClone(values.attrs.value) as typeof block.attrs,...convergenceClone(values.placement.value) as {parentId:string|null;slot:'body'|'summary';afterId:string|null}},binding,retirement:retired});
   if(!richBlockLeaf(block.type))continue;
   const leaf=prior.rich.bindings.nodes.find(n=>n.id===block.id);if(!leaf)return;
   for(const name of ['membership','selected','edge']){const witness=prior.scalar(name,block.id);if(!witness)return;const version=select(rich.root(name),block.id,witness.id,retired);if(!version||name==='membership'&&version.value!==true)return;scalars.set(JSON.stringify([name,block.id]),version);}
   const rule=prior.home({edge:leaf.edge});if(!rule||rule.node!==block.id)return;const version=select(rich.root('routing'),rule.version.key,rule.version.id,retired);if(!version)return;if(!registers.candidates(rich.root('routing')).some(v=>v.id===version.id))routes.push(version);
  }
  for(const[id,node]of nodes)result.nodes.set(id,node);for(const[key,value]of scalars)result.rich.scalars.set(key,value);for(const route of routes)if(!result.rich.routes.some(v=>v.id===route.id))result.rich.routes.push(route);
 };
 for(const witness of rich.tableWitnesses()){
  if(witness.route){if(witness.route.node!==null)contribute(witness.route.version.txId,witness.route.node);}
  else contribute(witness.birthTx,null,witness.ref);
 }
 // A current whole-table placement is itself a structural contribution. Its own
 // birth frontier must witness this exact table, even when its root membership
 // has been withdrawn. Other retained placements/transaction siblings grant nothing.
 for(const version of registers.candidates(source.root('placement'))){
  if(version.present&&registers.winner(source.root('placement'),version.key)?.id===version.id)contribute(version.txId,version.key,undefined,true);
 }
 // A surviving structural descendant (including an empty paragraph) is a witness too.
 for(const {block,binding}of source.retainedStructure().values()){
  const version=registers.versions.get(binding.placementVersionId);if(version&&block.parentId!==null)contribute(version.txId,block.parentId);
 }
 return result;
}
