import type { EraDocument } from '@/services/worldEras/types';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
const internal=new Set(['id','projectId','createdAt','updatedAt','revision','title','name','__worldEraAssetId']);
const prose=new Set(['content','html','body','text','description','notes']);
const label=(name:string)=>name.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,letter=>letter.toUpperCase());
function Value({value,es}:{value:unknown;es:boolean}) {
 if(value instanceof Blob)return <span>{value.type || (es?'Archivo':'File')} · {value.size.toLocaleString()} bytes</span>;
 if(typeof value==='string'&&/^data:[^,]*,/i.test(value))return <span>{es?'Archivo local conservado':'Retained local file'} · {value.slice(5,value.indexOf(';')>0?value.indexOf(';'):value.indexOf(','))}</span>;
 if(value===undefined||value===null||value==='')return <span className="text-text-muted">{es?'Vacío':'Empty'}</span>;
 if(typeof value==='boolean')return <span>{value?(es?'Sí':'Yes'):(es?'No':'No')}</span>;
 if(Array.isArray(value))return value.length?<ul className="space-y-2">{value.map((item,index)=><li key={index}><Value value={item} es={es}/></li>)}</ul>:<span className="text-text-muted">{es?'Ninguno':'None'}</span>;
 if(typeof value==='object')return <Fields row={value as Record<string,unknown>} es={es}/>;
 return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}
function Fields({row,es}:{row:Record<string,unknown>;es:boolean}) {
 return <dl className="space-y-3">{Object.entries(row).filter(([key])=>!internal.has(key)).map(([key,value])=><div key={key} className="min-w-0"><dt className="text-xs text-text-muted">{label(key)}</dt><dd className="mt-1 min-w-0 text-sm text-text-primary">{prose.has(key)&&typeof value==='string'?<div className="prose prose-sm max-w-prose break-words text-text-primary" dangerouslySetInnerHTML={{__html:sanitizeRichHtml(value)}}/>:<Value value={value} es={es}/>}</dd></div>)}</dl>;
}
const childLabels:Record<string,[string,string]>={sceneCasts:['Reparto','Cast'],dialogBlocks:['Turnos','Turns'],mapPins:['Marcadores','Map pins'],worldWaypoints:['Lugares','Places'],boardNodes:['Elementos del lienzo','Canvas elements'],boardEdges:['Conexiones','Connections'],boardLayers:['Capas','Layers'],boardViews:['Vistas','Views'],timelineEvents:['Sucesos','Events'],timelineConnections:['Conexiones','Connections']};
export default function DocumentVersionPreview({document,es}:{document:EraDocument;es:boolean}) {
 return <div className="max-h-[32rem] min-w-0 space-y-5 overflow-auto py-2 pr-2" data-testid="history-preview"><Fields row={document.root} es={es}/>{Object.entries(document.children).filter(([,rows])=>rows.length).map(([table,rows])=><details key={table}><summary className="cursor-pointer text-sm font-medium text-text-primary">{childLabels[table]?.[es?0:1]??label(table)} · {rows.length}</summary><ol className="mt-3 divide-y divide-border">{rows.map(row=><li key={row.id} className="py-3">{!!(row.title||row.name)&&<h4 className="mb-2 break-words text-sm font-medium text-text-primary">{String(row.title??row.name)}</h4>}<Fields row={row} es={es}/></li>)}</ol></details>)}</div>;
}
