import type {RichBlocks,StructuralNode} from './blocks';
import type {RichRuns} from './richRuns';
import type {RichRef} from './richTypes';
import type {HistoricalTableField,TableSupport} from './tableSupport';
import type {RegisterVersion} from './registers';
import type {RichBlock,RichBlockBinding} from './blockFormat';
import {validateRichBlockDocument,richBlockLeaf} from './blockFormat';
import {convergenceClone} from './format';
/** Per-dependency closure for table/row/column births withdrawn independently. */
export function deriveTableAxesSupport(source:RichBlocks,rich:RichRuns,read:(frontier:string[])=>HistoricalTableField):TableSupport {
 const result:TableSupport={nodes:new Map(),rich:{scalars:new Map(),routes:[]}},registers=source.registers,visited=new Set<string>();
 if(!registers.entries(source.root('membership')).some(v=>v.present&&v.value===true&&!registers.winner(source.root('membership'),v.key)))return result;
 const contribute=(txId:string,node:string|null,ref?:RichRef,columnId?:string,whole=false)=>{
  const key=JSON.stringify([txId,node,ref??null,columnId??null,whole]);if(visited.has(key))return;visited.add(key);
  const parents=registers.transactionParents(txId);if(!parents?.length||!registers.transactionAvailable(txId))return;
  const prior=read(parents);validateRichBlockDocument(prior.data,source.links,true,true,source.widths,source.images,source.alignment);
  const home=node===null&&ref?prior.home(ref):undefined,target=node??home?.node;if(!target)return;
  const byId=new Map(prior.data.blocks.map(b=>[b.id,b])),targetBlock=byId.get(target);if(!targetBlock)return;
  const required=new Map<string,RichBlock>(),seen=new Set<string>();let cursor:RichBlock|undefined=targetBlock,table:RichBlock|undefined;
  while(cursor){if(seen.has(cursor.id))return;seen.add(cursor.id);required.set(cursor.id,cursor);if(cursor.type==='table'){table=cursor;break;}
   if(cursor.type==='table-cell'){const column=byId.get(String(cursor.attrs.columnId));if(column?.type!=='table-column')return;required.set(column.id,column);}
   cursor=cursor.parentId===null?undefined:byId.get(cursor.parentId);
  }
  if(!table)return;
  if(columnId){const column=byId.get(columnId);if(column?.type!=='table-column'||column.parentId!==table.id)return;required.set(column.id,column);}
  if(whole){if(targetBlock.type!=='table')return;for(const b of prior.data.blocks)if(b.parentId===table.id&&(b.type==='table-row'||b.type==='table-column'))required.set(b.id,b);}
  const nodes=new Map<string,StructuralNode>(),scalars=new Map<string,RegisterVersion>(),routes:RegisterVersion[]=[];
  for(const block of required.values()){
   const bound=prior.bindings.nodes.find(b=>b.id===block.id);if(!bound)return;
   const currentMembership=registers.winner(source.root('membership'),block.id);if(currentMembership&&(!currentMembership.present||currentMembership.value!==true))return;
   let retirement:string|undefined;
   if(!currentMembership){const membership=registers.versions.get(bound.membershipVersionId),off=membership&&registers.activation(membership.id);if(!membership?.present||membership.value!==true||off?.enabled!==false||!registers.transactionAvailable(off.txId))return;retirement=off.txId;}
   const select=(root:string,key:string,id:string):RegisterVersion|undefined=>{
    const active=registers.winner(root,key);if(active)return active.present?active:undefined;
    const old=registers.versions.get(id),off=old&&registers.activation(id);if(!retirement||!old?.present||old.root!==root||old.key!==key||off?.enabled!==false||off.txId!==retirement)return;
    const before=registers.transactionParents(retirement);if(!before?.length)return;
    return registers.atFrontier(before,r=>r.winner(root,key)?.id===id)?old:undefined;
   };
   const values={}as Record<'kind'|'attrs'|'membership'|'placement',RegisterVersion>;
   for(const name of ['kind','attrs','membership','placement']as const){const v=select(source.root(name),block.id,bound[`${name}VersionId`]);if(!v)return;values[name]=v;}
   const binding:RichBlockBinding={id:block.id,kindVersionId:values.kind.id,attrsVersionId:values.attrs.id,membershipVersionId:values.membership.id,placementVersionId:values.placement.id};
   const actual={id:block.id,type:values.kind.value as RichBlock['type'],attrs:convergenceClone(values.attrs.value)as RichBlock['attrs'],...convergenceClone(values.placement.value)as Pick<RichBlock,'parentId'|'slot'|'afterId'>};
   nodes.set(block.id,{block:actual,binding,...(retirement?{retirement}:{})});
   if(!richBlockLeaf(block.type))continue;
   const leaf=prior.rich.bindings.nodes.find(n=>n.id===block.id);if(!leaf)return;
   for(const name of ['membership','selected','edge']){const witness=prior.scalar(name,block.id);if(!witness)return;const v=select(rich.root(name),block.id,witness.id);if(!v||name==='membership'&&v.value!==true)return;scalars.set(JSON.stringify([name,block.id]),v);}
   const rule=prior.home({edge:leaf.edge});if(!rule||rule.node!==block.id)return;const route=select(rich.root('routing'),rule.version.key,rule.version.id);if(!route)return;if(!registers.candidates(rich.root('routing')).some(v=>v.id===route.id))routes.push(route);
  }
  for(const[id,node]of nodes)result.nodes.set(id,node);for(const[key,value]of scalars)result.rich.scalars.set(key,value);for(const route of routes)if(!result.rich.routes.some(v=>v.id===route.id))result.rich.routes.push(route);
 };
 for(const witness of rich.tableWitnesses())if(witness.route){if(witness.route.node!==null)contribute(witness.route.version.txId,witness.route.node);}else contribute(witness.birthTx,null,witness.ref);
 for(const version of registers.candidates(source.root('placement')))if(version.present&&registers.winner(source.root('placement'),version.key)?.id===version.id)contribute(version.txId,version.key,undefined,undefined,true);
 for(const {block,binding}of source.retainedStructure().values()){
  const version=registers.versions.get(binding.placementVersionId);if(version&&block.parentId!==null)contribute(version.txId,block.parentId,undefined,block.type==='table-cell'?String(block.attrs.columnId):undefined);
 }
 return result;
}
