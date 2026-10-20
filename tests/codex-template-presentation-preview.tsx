import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {useLocaleStore} from '@/stores/localeStore';
import type {CodexEntry,Project} from '@/types';
import CodexTemplateManager from '@/components/codex/CodexTemplateManager';
import CodexEntryList from '@/components/codex/CodexEntryList';
import type {CodexTemplate} from '@/engines/codex/templateTypes';
export async function mountTemplatePresentationPreview(){
  const id='qa-template-presentation',now=Date.now(),canvas=document.createElement('canvas');canvas.width=200;canvas.height=260;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#344c4b';ctx.fillRect(0,0,200,260);ctx.fillStyle='#608a81';ctx.beginPath();ctx.arc(100,90,45,0,2*Math.PI);ctx.fill();ctx.fillRect(60,140,80,120);const image=canvas.toDataURL('image/png');
  const make=(templateId:string,name:string,meta:Partial<CodexTemplate>):CodexTemplate=>({id:templateId,name,category:'custom',fields:{},content:'',revision:1,createdAt:now,updatedAt:now,...meta});
  const templates=[make('qa-portrait','Habitantes',{icon:'User',color:'#d5b575',imageLayout:'portrait'}),make('qa-landscape','Regiones',{icon:'Map',color:'#60ad8e',imageLayout:'landscape'}),make('qa-none','Documentos reservados',{icon:'Scroll',color:'#aa91cc',imageLayout:'none',hiddenFromPickers:true})];
  const project:Project={id,title:'Las costas del norte',description:'',mode:'custom',type:'standalone',status:'draft',color:'#d5b575',enabledEngines:['codex'],engineOrder:['codex'],createdAt:now,updatedAt:now,codexTemplates:templates};
  await db.projects.put(project);const entries:CodexEntry[]=templates.map((template,index)=>({id:`qa-style-entry-${index}`,projectId:id,title:['Nora, guardiana del faro','Bahía del Norte','El cuaderno de navegación'][index],type:'custom',templateId:template.id,avatar:image,avatarOriginal:image,fields:{},content:'',tags:[['personajes','costa','archivo'][index]],relations:[],createdAt:now,updatedAt:now}));await db.codexEntries.bulkPut(entries);useLocaleStore.setState({locale:'es',loaded:true});
  createRoot(document.getElementById('root')!).render(<MemoryRouter><main className="mx-auto max-w-6xl p-6 text-text-primary"><header className="mb-6"><p className="text-xs uppercase tracking-widest text-accent-gold">Writer’s Hoard · Codex</p><h1 className="mt-2 font-display text-3xl">Las costas del norte</h1></header>{location.search.includes('manager')?<CodexTemplateManager projectId={id} open initial={templates[2]} onClose={()=>{}} onUse={()=>{}}/>:<CodexEntryList projectId={id} entries={entries} onAdd={async()=>{}} onEdit={async()=>{}} onDelete={()=>{}}/>}</main></MemoryRouter>);
}
