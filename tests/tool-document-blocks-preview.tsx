import {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {EditorContent,useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {db} from '@/db';
import {useLocaleStore} from '@/stores/localeStore';
import {ToolDocumentBlock} from '@/components/editor/toolBlocks/ToolDocumentBlock';
import ToolDocumentControls from '@/components/editor/toolBlocks/ToolDocumentControls';
import ToolDocumentModal from '@/components/editor/toolBlocks/ToolDocumentModal';
import {createCodexBlockHost} from '@/components/editor/codexBlocks/model';
import {createRadarChart} from '@/engines/radar/model';
import '@/engines/tables';
export async function mountToolBlocksPreview(){
  const id='qa-tool-blocks',now=Date.now(),radar=createRadarChart('Perfil del puerto');
  await db.projects.put({id,title:'Las costas del norte',description:'',mode:'custom',type:'standalone',status:'draft',color:'#d5b575',enabledEngines:[],engineOrder:[],createdAt:now,updatedAt:now,radarCharts:[radar],dataTables:[{id:'qa-prices',title:'Comercio del puerto',mode:'sheet',columns:[{id:'a',name:'Mercancía',kind:'text'},{id:'b',name:'Precio',kind:'number'},{id:'c',name:'Doble',kind:'text'}],rows:[{id:'r1',cells:{a:'Sal marina',b:'18',c:'=B1*2'}},{id:'r2',cells:{a:'Madera de pino',b:'12',c:'=B2*2'}}]}]});
  await db.worldMaps.put({id:'qa-map',projectId:id,title:'El puerto y sus rutas',features:[{id:'bay',kind:'region',name:'Bahía del Norte',points:[{x:10,y:45},{x:70,y:40},{x:90,y:90},{x:30,y:95}],color:'#608a81'},{id:'road',kind:'path',name:'Ruta del faro',points:[{x:20,y:70},{x:50,y:40},{x:80,y:35}],color:'#d5b575'}],createdAt:now,updatedAt:now});
  useLocaleStore.setState({locale:'es',loaded:true});
  const block=(kind:string,doc:string)=>`<figure data-wh-tool-block="true" data-project-id="${id}" data-tool-kind="${kind}" data-document-id="${doc}" data-label="Documento local"></figure>`;
  function Fixture(){const editor=useEditor({extensions:[StarterKit,ToolDocumentBlock.configure(createCodexBlockHost({projectId:id,scopeId:'qa'}))],content:'<h2>La ciudad junto al agua</h2><p>El manuscrito conserva sus fuentes cerca. Los cambios del mundo se reflejan aquí sin copiar sus documentos.</p>'+block('maps','qa-map')+block('tables','qa-prices')+block('radar',radar.id)});useEffect(()=>{document.documentElement.dataset.ready='true';},[editor]);return <main className="mx-auto max-w-5xl p-5 text-text-primary"><header className="mb-5 border-b border-border pb-4"><p className="text-xs uppercase tracking-widest text-accent-gold">Writer’s Hoard · Manuscrito</p><h1 className="mt-2 font-display text-3xl">Las costas del norte</h1></header>{editor&&<ToolDocumentControls editor={editor} projectId={id} locale="es"/>}<article className="mt-4 rounded-xl border border-border bg-deep p-5"><EditorContent editor={editor}/></article></main>;}
  createRoot(document.getElementById('root')!).render(<MemoryRouter>{location.search.includes('source')?<ToolDocumentModal target={{projectId:id,kind:'tables',documentId:'qa-prices',label:''}} locale="es" onClose={()=>{}}/>:<Fixture/>}</MemoryRouter>);
}
