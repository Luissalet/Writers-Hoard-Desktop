import {generateWorld} from '@/engines/worldgen/core/pipeline';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {applyEdits,deserializeEdits,serializeEdits,type WorldEdit} from '@/engines/worldgen/core/edits';
import {labelAppearance,normalizeLabelChange,LABEL_FORMAT_FIELDS} from '@/engines/worldgen/core/labelShape';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const exact=(a:unknown,b:unknown,message:string)=>check(JSON.stringify(a)===JSON.stringify(b),message);
const format=(value:object)=>Object.fromEntries(LABEL_FORMAT_FIELDS.filter(field=>Object.hasOwn(value,field)).map(field=>[field,Reflect.get(value,field)]));

/** Sparse typography replay is independent of terrain, fonts installed or any renderer. */
export async function testWorldLabelFormatCore():Promise<string[]>{
 const world=generateWorld({...DEFAULT_PARAMS,width:128,seed:'own-label-format-core'}),key='label:10,12';
 const label:WorldEdit={kind:'label',x:10,y:12,text:'Mar Élodie 李明',style:'water',size:18,angle:.2,spacing:.3,curve:.2};
 const overrides={bold:false,italic:true,caps:false,color:'#a1b2c3',font:'serif'} as const;
 const change:WorldEdit={kind:'relabel',key,...overrides};
 const materialize=(edits:WorldEdit[])=>applyEdits(world,deserializeEdits(serializeEdits(edits))).labels[0];
 const initial=materialize([label]);exact(format(initial),{},'Legacy label must remain sparse');
 let current=materialize([label,change]);exact(format(current),overrides,'Replay preserves explicit false and font/color');
 check(current.text===initial.text&&current.key===key&&current.x===10&&current.y===12&&current.size===18&&current.angle===.2&&current.spacing===.3&&current.curve===.2,'Format replay changes no authored text/shape/identity');
 current=materialize([label,change,{kind:'relabel',key,style:'region'}]);exact(format(current),overrides,'Preset change preserves overrides');
 current=materialize([label,change,{kind:'relabel',key,italic:null}]);exact(format(current),{bold:false,caps:false,color:'#a1b2c3',font:'serif'},'One null deletes only its override');
 const reset:WorldEdit={kind:'relabel',key,bold:null,italic:null,caps:null,color:null,font:null};
 current=materialize([label,change,reset]);exact(format(current),{},'Reset restores absence rather than storing null');
 exact(deserializeEdits(serializeEdits([label,change,reset]))[2],reset,'Journal round trip retains null reset instruction');
 exact(normalizeLabelChange({...overrides,color:'#A1B2C3'}),overrides,'Boundary canonicalizes ink without losing false');
 for(const bad of[{bold:'false'},{italic:[]},{caps:1},{color:'red'},{font:'unavailable-face'}]){let failed=false;try{normalizeLabelChange(bad);}catch{failed=true;}check(failed,'Invalid optional format must fail normal validation');}
 const defaults={caps:false,italic:false,weight:600,color:'#ffe9c2',font:'own-context-family'};
 exact(labelAppearance(initial,defaults),{text:initial.text,weight:600,italic:false,color:'#ffe9c2',font:'own-context-family'},'Absent format keeps exact supplied context defaults');
 const explicit=labelAppearance({...initial,...overrides},{...defaults,caps:true,italic:false,weight:700});check(explicit.text===initial.text&&explicit.weight===400&&explicit.italic&&explicit.color==='#a1b2c3','Explicit false beats caps/weight defaults without editing text');
 return['Label format uses sparse journal/replay, typed false and nullable per-field reset; preset/text/shape/key remain intact','Normal format validation canonicalizes ink and rejects invalid types/font IDs; context defaults survive absence'];
}
