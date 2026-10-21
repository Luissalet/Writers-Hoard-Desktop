import {defineLocalTool} from '@/engines/local/sdk';
import {codecDefinition,codecFixtures,initial} from './local-tool-codec.node';
export const documentDefinition=defineLocalTool({...codecDefinition,namespace:'tests.source-doc',document:{defaultTitle:{en:'Document',es:'Documento'}}});
export const sourceDocument=(id:string,title=id)=>({id,namespace:documentDefinition.namespace,title,revision:1,createdAt:1,updatedAt:1,data:structuredClone(initial),codec:structuredClone(documentDefinition.codec!)});
export function documentFixtures(){const fixture=codecFixtures();return{...fixture,projects:fixture.projects.map(project=>({...project,sourceToolDocuments:[sourceDocument('doc-a'),sourceDocument('doc-b')]}))};}

export const retainedIncompatibleDefinition=defineLocalTool({...documentDefinition,validateState:(value:import('@/engines/local/sdk').LocalToolJson):value is import('@/engines/local/sdk').LocalToolJson=>documentDefinition.validateState(value)&&(value as Record<string,unknown>).other!=='RESTORABLE_PIN_SENTINEL'});
export const retainedIncompatibleRelease={format:'writers-hoard-local-tool-source/1' as const,apiVersion:1 as const,namespace:documentDefinition.namespace,contentHash:'d'.repeat(64),version:'retained-incompatible',files:[{path:'module.tsx',sha256:'f'.repeat(64),bytes:1}]};
