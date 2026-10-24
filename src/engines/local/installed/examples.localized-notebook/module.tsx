import {useEffect,useState} from 'react';
import {defineLocalTool,defineLocalToolBlock,LocalToolRichProseEditor,useLocalToolT,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
type Notes={notes:string};
const initialState:Notes={notes:''},codec={version:1 as const,fields:{notes:{kind:'prose' as const,format:'rich' as const}}};
const preview={version:1 as const,fields:[{key:'notes',label:{en:'Notes',es:'Notas'}}]};
const locales={defaultLocale:'en',catalogs:{en:{notebook:{title:'Local notebook',help:'Write in your own language. Save your notes before leaving.',notes:'Your notes',saved:'Last saved: {date}'}},es:{notebook:{title:'Libreta local',help:'Escribe en tu idioma. Guarda tus notas antes de salir.',notes:'Tus notas',saved:'Último guardado: {date}'}}}};
const validateState=(value:LocalToolJson):value is Notes=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.notes==='string';
// Author packages export a definition rather than a refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
function Notebook({client,context}:LocalToolProps<Notes>){
 const messages=useLocalToolT(client),[saved,setSaved]=useState<number|null>(null);
 useEffect(()=>{let active=true;const refresh=()=>{void client.read().then(row=>{if(active)setSaved(row.updatedAt);}).catch(()=>{});};refresh();const off=client.subscribe?.(refresh);return()=>{active=false;off?.();};},[client]);
 return <section data-localized-notebook className="min-w-0 space-y-4 p-4 text-text-primary">
  <h2 className="font-display text-xl">{messages('notebook.title')}</h2>
  <p className="max-w-prose text-sm text-text-muted">{messages('notebook.help')}</p>
  <LocalToolRichProseEditor client={client} context={context} field="notes" label={messages('notebook.notes')}/>
  {saved!==null&&<p className="text-sm text-text-muted">{messages('notebook.saved',{date:messages.date(saved,{dateStyle:'medium',timeStyle:'short'})})}</p>}
 </section>;
}
const definition=defineLocalTool({namespace:'examples.localized-notebook',name:{en:'Localized notebook',es:'Libreta traducida'},description:{en:'Own tool catalogs follow the reader language while authored notes stay unchanged.',es:'Los textos de la herramienta siguen el idioma del lector sin cambiar sus notas.'},locales,initialState,codec,preview,validateState,document:{defaultTitle:{en:'Notes',es:'Notas'},embed:'interactive'},component:Notebook,blocks:[defineLocalToolBlock({key:'notes',name:{en:'Localized notebook',es:'Libreta traducida'},scope:'host',initialState,codec,preview,validateState,component:Notebook})]});

export default definition;
