import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { readWorldDocument, saveEraDocument } from '@/services/worldEras/store';
import { actOnEntityCandidateDismissal as act, getEntityCandidateDismissals as read } from '@/services/entityDetection/service';
import type { EntityCandidateScope } from '@/services/entityDetection/dismissalTypes';
import type { Project, Writing, CodexEntry } from '@/types';
import type { WritingSnapshot } from '@/engines/writings/snapshotTypes';

const P = 'qa-ner-native', C = P + '-foreign', N = P + '-without-codex', A = P + '-A', B = P + '-B', D = P + '-draft', ED = P + '-era-draft', E = 'past', K = P + '-known', F = C + '-writing', NW = N + '-writing';
const TEXT = 'Nora travelled with Rowan to Castle Blackthorn. La Guía kept the authored link.';
const check = (value: unknown, message: string) => { if (!value) throw Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function reject(work: () => Promise<unknown>, message: string) { let rejected = false; try { await work(); } catch { rejected = true; } check(rejected, message); }
const scopes = {
 base: { projectId: P, context: { kind: 'writings', documentId: A } },
 other: { projectId: P, context: { kind: 'writings', documentId: B } },
 era: { projectId: P, eraId: E, context: { kind: 'writings', documentId: A } },
 draft: { projectId: P, context: { kind: 'writings', documentId: A, draftId: D } },
 eraDraft: { projectId: P, eraId: E, context: { kind: 'writings', documentId: A, draftId: ED } },
 codex: { projectId: P, context: { kind: 'codex', documentId: K } },
 withoutCodex: { projectId: N, context: { kind: 'writings', documentId: NW } },
} satisfies Record<string, EntityCandidateScope>;
const candidate = (name: string) => ({ from: TEXT.indexOf(name), to: TEXT.indexOf(name) + name.length, text: name, label: 'PER' as const, score: .99 });

async function snapshot() {
 const business: Record<string, unknown[]> = {};
 for (const table of db.tables) business[table.name] = (await table.toArray()).map(row => { if (table.name !== 'projects' || ![P,N].includes(row.id)) return row; const copy = { ...row }; delete copy.entityCandidateDismissals; return copy; });
 const decisions = await db.projects.bulkGet([P,N]);
 return { business, ledgers: decisions.map(project => ({ id: project?.id, hasField: !!project && Object.hasOwn(project,'entityCandidateDismissals'), value: project?.entityCandidateDismissals })) };
}

export async function testEntityCandidateDismissalsNative(): Promise<string[]> {
 check(await db.projects.count() === 0, 'Native NER requires its own initially empty profile');
 const project = (id: string, engines = ['writings','codex']): Project => ({ id, title: 'Own native NER ' + id, description: 'Synthetic metadata fixture', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', enabledEngines: engines, engineOrder: engines, createdAt: 1, updatedAt: 1, worldEras: [{ id:E, name:'Past',description:'',revision:1,createdAt:1,updatedAt:1 }] });
 const writing = (id: string, projectId = P): Writing => ({ id, projectId, title:id, content:'<p>'+TEXT+'</p>', wordCount:15, status:'draft', tags:['keep'], createdAt:1,updatedAt:1 });
 const known: CodexEntry = {id:K,projectId:P,title:'Known Pilot',type:'character',fields:{aliases:'["La Guía"]',keep:'exact'},content:'<p>'+TEXT+'</p>',tags:['keep'],relations:[],createdAt:1,updatedAt:1};
 const draft: WritingSnapshot = {id:D,writingId:A,projectId:P,title:'Own draft',content:'<p>'+TEXT+'</p>',wordCount:15,reason:'manual',kind:'parallel-draft',draftName:'Own alternative',basedOnVersion:1,createdAt:1,updatedAt:1};
 let closed = false;
 const cleanup = async () => {
  if (!closed) { for (const id of [P,C,N]) await deleteProject(id); closed = true; }
  return { projects: await db.projects.count(), writings: await db.writings.count(), codex: await db.codexEntries.count(), drafts: await db.writingSnapshots.count(), variants: await db.worldEraVariants.count(), history: await db.documentHistory.count(), links: await db.entityLinks.count() };
 };
 try {
  await db.projects.bulkAdd([project(P),project(C),project(N,['writings'])]);
  await db.writings.bulkAdd([writing(A),writing(B),writing(F,C),writing(NW,N)]); await db.codexEntries.add(known); await db.writingSnapshots.add(draft);
  const scope = {projectId:P,eraId:E}, current=(await readWorldDocument(scope,'writings',A))!;
  await saveEraDocument(scope,'writings',{...current.document,children:{...current.document.children,writingSnapshots:[...current.document.children.writingSnapshots??[],{...draft,id:ED,draftName:'Era-only alternative'} as unknown as Record<string,unknown>&{id:string}]}},current.version);
  check(!await db.writingSnapshots.get(ED),'Era-only draft must not have Base row');
  Reflect.set(window,'__nerNativeSnapshot',snapshot); Reflect.set(window,'__nerNativeCleanup',cleanup);
  Reflect.set(window,'__nerNativeRootProbe',async()=>{
   const scope=scopes.other, baseline=JSON.stringify(await snapshot()); let receipt='';
   await reject(()=>db.transaction('rw',db.tables,async()=>{const result=await act(scope,{action:'dismiss',text:TEXT,candidate:candidate('Nora'),expectedVersion:''});receipt=result.receiptId!;throw Error('Intentional NER root abort');}),'Expected outer abort');
   check(JSON.stringify(await snapshot())===baseline,'Root abort changed business/ledger snapshot'); await reject(()=>act(scope,{action:'undo',receiptId:receipt}),'Aborted receipt became available');
   let committed=''; await db.transaction('rw',db.tables,async()=>{committed=(await act(scope,{action:'dismiss',text:TEXT,candidate:candidate('Nora'),expectedVersion:''})).receiptId!;});
   const beforeUndo=JSON.stringify(await snapshot()); await reject(()=>db.transaction('rw',db.tables,async()=>{await act(scope,{action:'undo',receiptId:committed});throw Error('Intentional NER inverse abort');}),'Expected inverse outer abort');
   check(JSON.stringify(await snapshot())===beforeUndo,'Inverse abort changed exact snapshot'); await act(scope,{action:'undo',receiptId:committed});
   check(JSON.stringify(await snapshot())===baseline,'Committed inverse did not restore exact absence');
   check((await read(scope)).decisions.length===0,'Root probe decisions remained');
   return {awaitedOuterCommit:true,rootAbortExact:true,abortedReceiptUnavailable:true,undoAbortReservationReleased:true,undoRetryExact:true,transportClaim:'separate renderer domain transaction probe, not stdio/HTTP transaction'};
  });
  Reflect.set(window,'__nerNativeReady',{projectId:P,controlId:C,withoutCodexId:N,foreignWritingId:F,eraOnlyDraftId:ED,scopes,text:TEXT,candidates:['Nora','Rowan','Castle Blackthorn','La Guía'].map(candidate),inference:'not installed or invoked; spans are explicit metadata action inputs, not detector results'});
  for(let i=0;i<8000&&Reflect.get(window,'__nerNativeComplete')===undefined;i++)await pause();
  const result=Reflect.get(window,'__nerNativeComplete') as {ok:boolean;error?:string}|undefined;check(result?.ok,result?.error??'Native NER completion timeout');check(closed,'Native driver omitted cleanup');
  return ['Two real stdio keys through private Mainbridge writes-enabled Native executor/IPC/renderer; metadata list/action/Undo, Base/era/draft/Codex-OFF isolation, per-key CAS/no-op/stale and root rollback; cleanup0/EOF0. No NER model or positive inference claim.'];
 } finally { await cleanup(); }
}
