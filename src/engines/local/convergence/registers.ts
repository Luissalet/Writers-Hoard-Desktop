import type {CausalTransaction,RegisterVersion,RegisterActivation,Toggle} from './formatTypes';
export type {CausalTransaction,RegisterVersion,RegisterActivation,Toggle} from './formatTypes';
import {JsonMap} from './json';
export {JsonMap,JsonArray} from './json';
import * as Y from 'yjs';
import type {LocalToolJson} from '../stateTypes';
import {localToolStateEqual} from '../stateActions';
import {convergenceCanonical,convergenceClone} from './format';
const clone=<T>(value:T):T=>convergenceClone(value);

export class Registers {
 readonly transactions:JsonMap<CausalTransaction>;
 readonly versions:JsonMap<RegisterVersion>;
 readonly activations:JsonMap<RegisterActivation>;
 private groups:Map<string,RegisterVersion[]>|null=null;
 private activationGroups:Map<string,RegisterActivation[]>|null=null;
 private completeMemo=new Map<string,boolean|null>();
 private ancestorMemo=new Map<string,Set<string>>();
 private context:{id:string;parents:string[];writes:Map<string,RegisterVersion>}|null=null;
 constructor(doc:Y.Doc){
  this.doc=doc;
  this.transactions=new JsonMap(doc.getMap('causal-transactions'));this.versions=new JsonMap(doc.getMap('register-versions'));this.activations=new JsonMap(doc.getMap('register-activations'));
  this.transactions.observe(()=>this.invalidate());this.versions.observe(()=>this.invalidate());this.activations.observe(()=>this.invalidate());
 }
 readonly doc:Y.Doc;
 private invalidate(){this.groups=null;this.activationGroups=null;this.completeMemo.clear();this.ancestorMemo.clear();}
 entries(root:string,key?:string):RegisterVersion[]{
  if(!this.groups){this.groups=new Map();for(const version of this.versions.values()){const group=convergenceCanonical([version.root,version.key]);const values=this.groups.get(group)??[];values.push(version);this.groups.set(group,values);}}
  return key===undefined?[...this.groups.values()].flat().filter(version=>version.root===root):this.groups.get(convergenceCanonical([root,key]))??[];
 }
 complete(txId:string):boolean {
  if(this.completeMemo.has(txId))return this.completeMemo.get(txId)===true;
  const tx=this.transactions.get(txId);if(!tx)return false;this.completeMemo.set(txId,null);
  const complete=tx.parents.every(parent=>this.complete(parent));this.completeMemo.set(txId,complete);return complete;
 }
 ancestors(txId:string,visiting=new Set<string>()):Set<string> {
  const cached=this.ancestorMemo.get(txId);if(cached)return cached;if(visiting.has(txId))throw Error('local_tool_convergence_transaction_cycle');
  const all=new Set<string>(),next=new Set(visiting);next.add(txId);
  for(const parent of this.transactions.get(txId)?.parents??[]){all.add(parent);for(const ancestor of this.ancestors(parent,next))all.add(ancestor);}
  this.ancestorMemo.set(txId,all);return all;
 }
 private maximum<T extends {id:string;txId:string}>(values:T[]):T|undefined {
  let chosen:T|undefined;
  for(const value of values){if(values.some(other=>other.txId!==value.txId&&this.ancestors(other.txId).has(value.txId)))continue;if(!chosen||value.id>chosen.id)chosen=value;}
  return chosen;
 }
 activation(versionId:string):RegisterActivation|undefined {
  if(!this.activationGroups){this.activationGroups=new Map();for(const activation of this.activations.values()){const values=this.activationGroups.get(activation.versionId)??[];values.push(activation);this.activationGroups.set(activation.versionId,values);}}
  return this.maximum((this.activationGroups.get(versionId)??[]).filter(activation=>this.complete(activation.txId)));
 }
 winner(root:string,key:string,eligible?:(version:RegisterVersion)=>boolean,includePending=true):RegisterVersion|undefined {
  const staged=includePending?this.context?.writes.get(convergenceCanonical([root,key])):undefined;if(staged&&(!eligible||eligible(staged)))return staged;
  return this.maximum(this.entries(root,key).filter(version=>this.complete(version.txId)&&this.activation(version.id)?.enabled===true&&(!eligible||eligible(version))));
 }
 private heads():string[]{const heads=new Set(this.transactions.keys());for(const tx of this.transactions.values())for(const parent of tx.parents)heads.delete(parent);return [...heads];}
 /** Complete causal frontier only; incomplete imports never manufacture a capture basis. */
 frontier():string[]{
  const complete=[...this.transactions.values()].filter(tx=>this.complete(tx.id)),heads=new Set(complete.map(tx=>tx.id));
  for(const tx of complete)for(const parent of tx.parents)heads.delete(parent);return[...heads].sort();
 }
 /** Synchronous historical reader over retained versions, never a writer or another DAG. */
 atFrontier<T>(frontier:readonly string[],read:(view:Registers)=>T):T{
  if(!Array.isArray(frontier)||!frontier.length||new Set(frontier).size!==frontier.length||frontier.some(id=>typeof id!=='string'||!this.complete(id)))throw Error('local_tool_convergence_frontier_invalid');
  const included=new Set<string>();for(const id of frontier){included.add(id);for(const ancestor of this.ancestors(id))included.add(ancestor);}
  const view=Object.create(this) as Registers;
  // Derived only for this synchronous historical read; never reused after a document mutation.
  const entriesMemo=new Map<string,readonly RegisterVersion[]>(),candidatesMemo=new Map<string,readonly RegisterVersion[]>(),activationMemo=new Map<string,RegisterActivation|undefined>();
  let activationGroups:Map<string,RegisterActivation[]>|undefined;
  const activation=(id:string)=>{
   if(activationMemo.has(id))return activationMemo.get(id);
   if(!activationGroups){activationGroups=new Map();for(const item of this.activations.values())if(included.has(item.txId)){const group=activationGroups.get(item.versionId)??[];group.push(Object.freeze(item));activationGroups.set(item.versionId,group);}}
   const chosen=this.maximum(activationGroups.get(id)??[]);activationMemo.set(id,chosen);return chosen;
  };
  const entries=(root:string)=>{let values=entriesMemo.get(root);if(!values){values=Object.freeze(this.entries(root).filter(v=>included.has(v.txId)));entriesMemo.set(root,values);}return values;};
  const candidates=(root:string)=>{let values=candidatesMemo.get(root);if(!values){values=Object.freeze(entries(root).filter(v=>activation(v.id)?.enabled===true));candidatesMemo.set(root,values);}return values;};
  // Return fresh arrays as before; cached arrays remain private and immutable.
  view.entries=(root,key)=>key===undefined?[...entries(root)]:entries(root).filter(v=>v.key===key);
  view.candidates=root=>[...candidates(root)];
  view.winner=(root,key,eligible)=>this.maximum(candidates(root).filter(v=>v.key===key&&(!eligible||eligible(v))));
  view.activation=activation;view.complete=id=>included.has(id);view.transactionAvailable=id=>included.has(id);view.frontier=()=>[...frontier].sort();
  return read(view);
 }

 begin():void {if(this.context)throw Error('local_tool_convergence_transaction_nested');this.context={id:crypto.randomUUID(),parents:this.heads(),writes:new Map()};}
 cancel():void {this.context=null;}
 flush():string[]{
  const context=this.context;if(!context)throw Error('local_tool_convergence_transaction_missing');this.context=null;
  if(!context.writes.size)return[];this.transactions.set(context.id,{id:context.id,parents:context.parents});const ids:string[]=[];
  for(const version of context.writes.values()){this.versions.set(version.id,version);const activationId=crypto.randomUUID();this.activations.set(activationId,{id:activationId,versionId:version.id,enabled:true,txId:context.id});ids.push(version.id);}
  this.invalidate();return ids;
 }
 write(root:string,key:string,present:boolean,value:LocalToolJson=null):void {
  if(!this.context)throw Error('local_tool_convergence_transaction_missing');
  const group=convergenceCanonical([root,key]),before=this.winner(root,key,undefined,false);
  if(before&&before.present===present&&(!present||localToolStateEqual(before.value,value))){this.context.writes.delete(group);return;}
  if(!before&&!present){this.context.writes.delete(group);return;}
  const previous=this.context.writes.get(group),id=previous?.id??crypto.randomUUID();
  this.context.writes.set(group,{id,root,key,present,value:present?clone(value):null,txId:this.context.id});
 }
 toggle(changes:readonly Toggle[]):Toggle[]{
  if(this.context)throw Error('local_tool_convergence_transaction_nested');const effective:Toggle[]=[],inverse:Toggle[]=[];
  for(const change of changes){if(!this.versions.has(change.id))throw Error('local_tool_convergence_receipt_unavailable');const enabled=this.activation(change.id)?.enabled??false;
   if(enabled!==change.enabled){effective.push(clone(change));inverse.push({id:change.id,enabled});}
  }
  if(!effective.length)return[];const txId=crypto.randomUUID(),parents=this.heads();this.transactions.set(txId,{id:txId,parents});
  for(const change of effective){const id=crypto.randomUUID();this.activations.set(id,{id,versionId:change.id,enabled:change.enabled,txId});}this.invalidate();return inverse;
 }
 map<T>(root:string){
  function* iterate(registers:Registers):IterableIterator<[string,T]>{const keys=new Set([...registers.entries(root).map(version=>version.key),...[...(registers.context?.writes.values()??[])].filter(version=>version.root===root).map(version=>version.key)]);for(const key of keys){const version=registers.winner(root,key);if(version?.present)yield[key,clone(version.value) as T];}}
  return{
  get:(key:string):T|undefined=>{const version=this.winner(root,key);return version?.present?clone(version.value) as T:undefined;},
  set:(key:string,value:T)=>{this.write(root,key,true,value as LocalToolJson);},
  delete:(key:string)=>{this.write(root,key,false);},
  [Symbol.iterator]:()=>iterate(this),
 };}
 pending():boolean {
  return [...this.transactions.keys()].some(id=>!this.complete(id))||[...this.versions.values()].some(version=>!this.complete(version.txId)||!this.activation(version.id))||[...this.activations.values()].some(activation=>!this.versions.has(activation.versionId)||!this.complete(activation.txId));
 }
 validate():void {
  for(const[id,tx]of this.transactions){if(!tx||tx.id!==id||!Array.isArray(tx.parents)||tx.parents.some(parent=>typeof parent!=='string'||parent===id)||new Set(tx.parents).size!==tx.parents.length)throw Error('local_tool_convergence_transaction_invalid');this.ancestors(id);}
  for(const[id,version]of this.versions){if(!version||version.id!==id||typeof version.root!=='string'||typeof version.key!=='string'||typeof version.present!=='boolean'||typeof version.txId!=='string')throw Error('local_tool_convergence_register_invalid');convergenceClone(version);}
  for(const[id,activation]of this.activations)if(!activation||activation.id!==id||typeof activation.versionId!=='string'||typeof activation.enabled!=='boolean'||typeof activation.txId!=='string')throw Error('local_tool_convergence_activation_invalid');
 }
 /** Plain interval roots reuse the same active versions and global transaction frontier. */
 candidates(root:string):RegisterVersion[]{
  const staged=[...(this.context?.writes.values()??[])].filter(version=>version.root===root),replaced=new Set(staged.map(version=>version.key));
  return [...this.entries(root).filter(version=>!replaced.has(version.key)&&this.complete(version.txId)&&this.activation(version.id)?.enabled===true),...staged];
 }
 maximumCandidate(values:RegisterVersion[]):RegisterVersion|undefined {
  const staged=this.context?values.filter(value=>value.txId===this.context!.id):[];
  return this.maximum(staged.length?staged:values);
 }
 transactionAvailable(txId:string):boolean{return txId===this.context?.id||this.complete(txId);}
 currentTransactionId():string{if(!this.context)throw Error('local_tool_convergence_transaction_missing');return this.context.id;}
}
