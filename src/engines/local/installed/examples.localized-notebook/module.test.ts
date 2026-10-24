import definition from './module';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import {createLocalToolTranslator,resolveLocalToolLocale} from '@/engines/local/sdk';
/** Own minimal source inputs reused by normal package/release tests, not a foreign source clone. */
export function localePackageSource(label:string){return `import {defineLocalTool} from '@/engines/local/sdk';export default defineLocalTool({namespace:'test.locale-release',name:{en:'${label}',es:'${label}'},description:{en:'Own locale release',es:'Versión propia'},initialState:{notes:''},validateState:()=>true,component:()=>null,locales:{defaultLocale:'en',catalogs:{en:{label:'${label}'}}}});`;}
export async function testLocalToolScaffold(){
 const host=createFakeLocalToolHost(definition,{projects:[{id:'locale-author',updatedAt:1,worldEras:[{id:'past'}]}]},{locale:'en'}),client=host.createClient({projectId:'locale-author'}),before=await client.read();
 host.setLocale('es');const messages=createLocalToolTranslator(resolveLocalToolLocale({...client.locale!.declaration,locale:client.locale!.getSnapshot()}));if(messages('notebook.title')!=='Libreta local'||JSON.stringify(await client.read())!==JSON.stringify(before))throw Error('Locale changed authored state or failed own catalog');
 await client.save({notes:'<p>Nora writes in her own language.</p>'},before.revision);const era=host.createClient({projectId:'locale-author',eraId:'past'}),inherited=await era.read();await era.save({notes:'<p>Past note.</p>'},inherited.revision);if((await client.read()).data.notes!== '<p>Nora writes in her own language.</p>')throw Error('Locale example era changed Base');
 return ['Real author module locale metadata and memory-host language update preserve authored state and Base/era isolation'];
}
