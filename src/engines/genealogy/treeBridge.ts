import { getEraProject, listEraRows,readWorldDocument } from '@/services/worldEras/store';
import {db} from '@/db';
import { BridgeError, optString, requireString, resolveProjectForEngine, resolveProjectId, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { generateId } from '@/utils/idGenerator';
import type { CodexEntry } from '@/types';
import { createTreePreset, TREE_PRESETS, treePresetNames, type TreePreset } from './treePresets';
import { exportRelationTreeSvg, type RelationTreeDocument,type RelationVocabulary,type RelationTreeEdge } from './relationTrees';
import {addTreeNeighbor,reconnectTreeEdge,saveTreeVocabulary,removeTreeVocabulary,applyTreeVocabulary,type TreeSide} from './treeAffordances';
import {issueTreeReceipt} from './treeUndo';
import { deleteRelationTree, saveRelationTree } from './relationTreeStore';
function scope(args: ToolArgs) { return { projectId: resolveProjectId(args), eraId: optString(args, 'eraId') }; }
function expected(args: ToolArgs) { if (!Number.isSafeInteger(args.expectedRevision) || Number(args.expectedRevision) < 1) throw new BridgeError('bad-args', 'Read the current expectedRevision from get.'); return Number(args.expectedRevision); }
async function current(args: ToolArgs) { const context = scope(args), tree = (await getEraProject(context)).relationTrees?.find(item => item.id === requireString(args, 'treeId')); if (!tree) throw new BridgeError('not-found', 'Tree not found in this context.'); return { ...context, tree }; }
export const RELATION_TREE_HANDLERS = {
  async wh_relation_tree_action(args:ToolArgs){
    await resolveProjectForEngine(args,'genealogy');const expectedRevision=expected(args);
    return db.transaction('rw',db.tables,async tx=>{
      const {projectId,eraId,tree}=await current(args),context={projectId,eraId};if(tree.revision!==expectedRevision)throw new BridgeError('conflict','Tree changed; read its current revision before reapplying.');
      const before=await readWorldDocument(context,'genealogy',tree.id);if(!before)throw new BridgeError('not-found','Tree missing.');let next=tree;
      const action=requireString(args,'action');
      try{
        const vocabulary=async()=>{const sourceTree=(await getEraProject(context)).relationTrees?.find(item=>item.id===(optString(args,'vocabularyTreeId')??tree.id)),value=sourceTree?.relationVocabulary?.find(item=>item.id===requireString(args,'vocabularyId'));if(!value)throw new BridgeError('not-found','Vocabulary not found in this project and era.');return value;};
        if(action==='neighbor'){
          const codexEntryId=optString(args,'codexEntryId'),entry=codexEntryId?(await listEraRows<CodexEntry>(context,'codexEntries')).find(item=>item.id===codexEntryId):undefined;if(codexEntryId&&!entry)throw new BridgeError('bad-args','Card is outside this effective project.');
          const relation=args.vocabularyId?await vocabulary():{kind:args.relationKind as RelationTreeEdge['kind']??'custom',label:optString(args,'relationshipLabel'),icon:optString(args,'icon'),style:args.style as RelationTreeEdge['style']??'solid'};
          next=addTreeNeighbor(tree,requireString(args,'nodeId'),requireString(args,'side') as TreeSide,{id:generateId('tree-node'),label:entry?.title||optString(args,'label')?.trim()||'Node',codexEntryId},generateId('tree-edge'),relation,args.reverse===true);
        }else if(action==='reconnect')next=reconnectTreeEdge(tree,requireString(args,'edgeId'),requireString(args,'endpoint') as 'source'|'target',requireString(args,'nodeId'),requireString(args,'side') as TreeSide);
        else if(action==='vocabulary-save'){const value=args.value as RelationVocabulary|undefined;if(!value||typeof value!=='object')throw new BridgeError('bad-args','A named vocabulary value is required.');next=saveTreeVocabulary(tree,{...value,id:value.id||generateId('tree-vocabulary')});}
        else if(action==='vocabulary-remove')next=removeTreeVocabulary(tree,requireString(args,'vocabularyId'));
        else if(action==='vocabulary-apply'){const value=await vocabulary();next=applyTreeVocabulary(tree,requireString(args,'edgeId'),value);if(args.copy===true)next=saveTreeVocabulary(next,{...value,id:generateId('tree-vocabulary')});}
        else throw new BridgeError('bad-args','Unknown tree action.');
      }catch(error){if(error instanceof BridgeError)throw error;throw new BridgeError('bad-args',error instanceof Error?error.message:'Invalid tree action.');}
      if(next===tree)return{...context,tree,noChange:true};
      // saveRelationTree decodes artwork before saving; keep the outer receipt transaction alive.
      const saved=await saveRelationTree(projectId,next,expectedRevision,eraId),after=(await readWorldDocument(context,'genealogy',tree.id))!,receiptId=issueTreeReceipt(tx,context,before,after.version);
      return withAudit({...context,tree:saved},{projectId,entityId:tree.id,kind:'update',summary:`Tree ${action}: ${saved.title}`,before:{__treeReceipt:receiptId}});
    });
  },
  async wh_relation_tree_list(args: ToolArgs) { const context = scope(args), project = await getEraProject(context); return { ...context, trees: (project.relationTrees ?? []).map(({ id, title, revision, preset }) => ({ id, title, revision, preset: preset ?? 'blank' })), presets: TREE_PRESETS.map(id => ({ id, name: { es: treePresetNames('es')[id], en: treePresetNames('en')[id] } })) }; },
  async wh_relation_tree_get(args: ToolArgs) { return current(args); },
  async wh_relation_tree_create(args: ToolArgs) { const projectId = await resolveProjectForEngine(args, 'genealogy'), eraId = optString(args, 'eraId'), draft = createTreePreset(generateId('relation-tree'), requireString(args, 'title'), requireString(args, 'preset') as TreePreset, optString(args, 'locale') ?? 'es', Date.now()), tree = await saveRelationTree(projectId, draft, null, eraId); return withAudit({ projectId, eraId, tree }, { projectId, entityId: tree.id, kind: 'create', summary: `Created relationship tree ${tree.title}` }); },
  async wh_relation_tree_save(args: ToolArgs) { const projectId = await resolveProjectForEngine(args, 'genealogy'), eraId = optString(args, 'eraId'); if (!args.tree || typeof args.tree !== 'object' || Array.isArray(args.tree)) throw new BridgeError('bad-args', 'A complete tree is required.'); const tree = await saveRelationTree(projectId, args.tree as unknown as RelationTreeDocument, expected(args), eraId); return withAudit({ projectId, eraId, tree }, { projectId, entityId: tree.id, kind: 'update', summary: `Saved relationship tree ${tree.title}` }); },
  async wh_relation_tree_archive(args: ToolArgs) { await resolveProjectForEngine(args, 'genealogy'); const { projectId, eraId, tree } = await current(args); await deleteRelationTree(projectId, tree.id, expected(args), eraId); return withAudit({ projectId, treeId: tree.id, archived: true }, { projectId, entityId: tree.id, kind: 'delete', summary: `Archived relationship tree ${tree.title}` }); },
  async wh_relation_tree_export(args: ToolArgs) { const { projectId, eraId, tree } = await current(args), entries = await listEraRows<CodexEntry>({ projectId, eraId }, 'codexEntries'); return { projectId, treeId: tree.id, svg: exportRelationTreeSvg(tree, new Map(entries.map(entry => [entry.id, entry.title]))) }; },
};
