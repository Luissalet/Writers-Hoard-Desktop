import '@/engines';
import { db } from '@/db';
import { loadWorldWikiData, buildWorldWiki } from '@/services/worldWikiExport';
import { captureWikiSnapshot, wikiSource } from '@/services/wikiProfiles/snapshot';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
import type { WorldWikiOptions } from '@/types/worldWiki';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const P = 'wiki-independent-review';
export const reviewWikiIndependent = () => runReview(true);
export const reviewWikiIndependentCore = () => runReview(false);
async function runReview(checkOmittedTree: boolean) {
  const passed: string[]=[];
  try {
    await db.projects.put({id:P,title:'Independent wiki',description:'',mode:'custom',type:'standalone',status:'draft',color:'#999',enabledEngines:['board','notes','genealogy'],engineOrder:[],createdAt:1,updatedAt:1,
      relationTrees:[{id:P+'-tree',title:'PRIVATE_OMITTED_TREE_NAME',nodes:[],edges:[],revision:0,createdAt:1,updatedAt:1}]} as Project);
    await db.notes.put({id:P+'-note',projectId:P,kind:'note',text:'PRIVATE_OMITTED_NOTE_TEXT',title:'PRIVATE_OMITTED_NOTE_TITLE',tags:[],pinned:false,createdAt:1,updatedAt:1});
    await db.boards.put({id:P+'-board',projectId:P,title:'Public board',surface:'white',createdAt:1,updatedAt:1});
    const common={projectId:P,boardId:P+'-board',kind:'entity' as const,color:'#fff',position:{x:0,y:0},size:{width:100,height:80},zIndex:1,createdAt:1,updatedAt:1};
    await db.boardNodes.bulkPut([
      {...common,id:P+'-missing',title:'PRIVATE_MISSING_CACHED_NAME',content:'PRIVATE_MISSING_CACHED_BODY',ref:{engineId:'notes',entityType:'note',entityId:P+'-missing-note',title:'PRIVATE_MISSING_CACHED_NAME'}},
      {...common,id:P+'-omitted-note',title:'PRIVATE_NOTE_CACHED_NAME',content:'PRIVATE_NOTE_CACHED_BODY',ref:{engineId:'notes',entityType:'note',entityId:P+'-note',title:'PRIVATE_NOTE_CACHED_NAME'}},
      {...common,id:P+'-omitted-tree',title:'PRIVATE_TREE_CACHED_NAME',content:'PRIVATE_TREE_CACHED_BODY',ref:{engineId:'genealogy',entityType:'relation-tree',entityId:P+'-tree',title:'PRIVATE_TREE_CACHED_NAME'}},
    ]);
    const snapshot=wikiSource(await captureWikiSnapshot({projectId:P}));
    assert(snapshot.documents?.('genealogy').some(item=>item.root.id===P+'-tree'),'Tree absent from effective capture');
    const options:WorldWikiOptions={types:[],includeMaps:false,additionalDocuments:[{kind:'board',id:P+'-board'}],excludedDocuments:[{kind:'notes',id:P+'-note'},{kind:'relation-tree',id:P+'-tree'}]};
    db.close();
    let html:string;
    try {
      html=buildWorldWiki(await loadWorldWikiData(P,options,snapshot),options).html;
      assert(html.includes('Public board'),'Captured board did not render with DB closed');
      assert(!/PRIVATE_MISSING_CACHED|PRIVATE_NOTE_CACHED|PRIVATE_OMITTED_NOTE/.test(html),'Missing/omitted note reference leaked its title or cached text');
      passed.push('Captured standalone board renders with DB closed; missing and omitted note references disclose no cached fallback');
      const onlyRevealed={...options,onlyRevealed:true};
      assert(!buildWorldWiki(await loadWorldWikiData(P,onlyRevealed,snapshot),onlyRevealed).html.includes('Public board'),'Unrevealed standalone board published');
      passed.push('Revealed-only excludes a standalone board from the same closed-DB capture');
      const hidden={...options,excludedDocuments:[],grouping:'manual' as const,sections:[{id:'parent',name:'Hidden parent',hideDocuments:true,documents:[]},{id:'child',parentId:'parent',name:'Child',documents:[{kind:'board' as const,id:P+'-board'}]}]};
      assert(!buildWorldWiki(await loadWorldWikiData(P,hidden,snapshot),hidden).html.includes('Public board'),'Hidden ancestor published the board');
      passed.push('Hidden parent excludes descendant board before page hydration from captured data');
      if(checkOmittedTree)assert(!html.includes('PRIVATE_OMITTED_TREE_NAME'),'PRIVACY REGRESSION: excludedDocuments relation-tree id='+P+'-tree survived in selected board via native ref.engineId genealogy; omitted source title appears in standalone HTML');
    } finally {await db.open();}
    if(checkOmittedTree)passed.push('Omitted genealogy reference exposes neither fresh nor cached tree title inside selected board');
    return passed;
  } finally { if(!db.isOpen())await db.open();if(await db.projects.get(P))await deleteProject(P); }
}
