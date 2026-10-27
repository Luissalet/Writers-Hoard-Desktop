import {defineLocalApp,registerLocalAppModules} from '@/engines/local/apps';
import {getLocalToolDefinition} from '@/engines/local/definitions';
import {sourceDocumentPreview} from '@/engines/local/documents/preview';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolReleaseIdentity,type LocalToolReleaseManifest} from '@/engines/local/releaseFormat.mjs';
import releaseChild from './local-app-definition-child.fixture';
import releaseChildRaw from './local-app-definition-child.fixture.tsx?raw';
type State={children:{id:string;document:{kind:'local-tool';documentId:string};variant:'panel'|'plain'}[];notes:string};
export async function testLocalAppDefinition(){
 const source=defineLocalApp({id:'qa.minimum-app',name:{en:'Minimum app',es:'App mínima'},description:{en:'Optional publication control',es:'Control de publicación opcional'},version:'1.0.0',tools:[],state:{initialState:{children:[],notes:'Own plain notes'} as State,codec:{version:1,fields:{children:{kind:'list',idKey:'id',referenceKey:'document'},notes:{kind:'prose'}}},validateState:(value:LocalToolJson):value is State=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.children)&&typeof value.notes==='string'},Host:({children})=><>{children}</>,Surface:({children})=><>{children}</>});
 if(source.app?.descriptor.publishPreset!==undefined||source.app.descriptor.state.preview.fields.some(field=>field.key==='children')||source.app.descriptor.state.preview.fields[0]?.key!=='notes')throw Error('LOCAL_APP_OPTIONAL_METADATA_INVALID');
 registerLocalAppModules({'./installed/qa.minimum-app/module.tsx':{default:source}},{},{'./installed/qa.minimum-app/app-definition.json':structuredClone(source.app.descriptor)});
 if(getLocalToolDefinition('qa.minimum-app')?.app?.descriptor.id!=='qa.minimum-app')throw Error('LOCAL_APP_MINIMUM_NOT_SOURCE_REGISTERED');
 const preview=sourceDocumentPreview({id:'own-preview',namespace:source.namespace,title:'Own preview',generation:'own-generation',revision:0,createdAt:1,updatedAt:1,data:{children:[{id:'one',document:{kind:'local-tool',documentId:'PRIVATE-TARGET'},variant:'plain'}],notes:'Own plain notes'},codec:source.codec,preview:source.preview},'en');
 if(!JSON.stringify(preview).includes('Own plain notes')||JSON.stringify(preview).includes('PRIVATE-TARGET'))throw Error('LOCAL_APP_MINIMUM_PREVIEW_EXPOSES_MEMBERSHIP');
 // App-first mixed batches must resolve compiled children without relying on
 // object insertion order or an earlier registration side effect.
 const ownApp=(id:string,tool:string)=>defineLocalApp({id,name:source.name,description:source.description,version:'1.0.0',tools:[tool],state:{initialState:{children:[],notes:''} as State,codec:source.codec!,validateState:source.validateState},Host:source.app!.Host,Surface:source.app!.Surface});
 const batchChild=defineLocalTool({...releaseChild,namespace:'qa.minimum-batch-child'}),batchApp=ownApp('qa.minimum-batch-app',batchChild.namespace);
 registerLocalAppModules({'./installed/qa.minimum-batch-app/module.tsx':{default:batchApp},'./installed/qa.minimum-batch-child/module.tsx':{default:batchChild}},{},{'./installed/qa.minimum-batch-app/app-definition.json':structuredClone(batchApp.app!.descriptor)});
 if(!getLocalToolDefinition(batchChild.namespace)?.document||!getLocalToolDefinition(batchApp.namespace)?.app)throw Error('LOCAL_APP_SAME_BATCH_DOCUMENT_NOT_COMPILED');
 // A normal release-only catalogue has no development definition. Its actual
 // compiled module/raw source supplies the release metadata for this control.
 const sha=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 const files=[{path:'module.tsx',sha256:await sha(releaseChildRaw),bytes:new TextEncoder().encode(releaseChildRaw).length}],version='1.0.0';
 const contentHash=await sha(localToolReleaseIdentity({namespace:releaseChild.namespace,version,files})),manifest:LocalToolReleaseManifest={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace:releaseChild.namespace,version,files,contentHash};
 const prefix='./installed/'+releaseChild.namespace+'/versions/'+contentHash+'/';
 registerLocalToolModules({[prefix+'module.tsx']:{default:releaseChild}},{[prefix+'release.json']:manifest});
 if(getLocalToolDefinition(releaseChild.namespace)!==undefined||!getLocalToolDefinition(releaseChild.namespace,contentHash)?.document)throw Error('LOCAL_APP_RELEASE_ONLY_CONTROL_INVALID');
 const releaseApp=ownApp('qa.minimum-release-app',releaseChild.namespace);
 registerLocalAppModules({'./installed/qa.minimum-release-app/module.tsx':{default:releaseApp}},{},{'./installed/qa.minimum-release-app/app-definition.json':structuredClone(releaseApp.app!.descriptor)});
 if(!getLocalToolDefinition(releaseApp.namespace)?.app)throw Error('LOCAL_APP_RELEASE_ONLY_DOCUMENT_NOT_COMPILED');
 return {cases:4,optionalPreviewAndPreset:true,normalSourceRegistry:true,moduleFreePreview:true,appFirstMixedBatch:true,releaseOnlyChildCatalogue:true};
}
