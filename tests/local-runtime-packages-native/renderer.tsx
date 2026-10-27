import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import {db} from '@/db';
import expected from './fixtures/EXPECTED.json';
let root:Root|undefined;
const base=Reflect.get(window,'__runtime59QA');if(!base)throw Error('Existing Native fixture missing');
function mount(input:{P:string;appId:string}){root?.unmount();root=createRoot(document.getElementById('root')!);root.render(<MemoryRouter><LocalToolDocumentHost projectId={input.P} namespace="qa.runtime-app59" documentId={input.appId}/></MemoryRouter>);return true;}
async function cleanup(input:{P:string;Q:string;marker:string}){root?.unmount();root=undefined;
 const b=expected.packages.find(p=>p.key==='b')!,a=expected.packages.find(p=>p.key==='a')!;
 const row=await db.localToolPackages.get(b.manifest.contentHash);if(row){if(row.namespace!==b.namespace)throw Error('Refuse foreign package cleanup');await db.localToolPackages.delete(b.manifest.contentHash);}
 return base.cleanup({...input,contentHash:a.manifest.contentHash,packageNamespace:a.namespace});
}
Reflect.set(window,'__peer59',{mount,cleanup});Reflect.set(window,'__peer59Ready',true);
