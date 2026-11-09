import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps,type AnnotationPresentation} from '@/engines/local/sdk';

type Data=Record<string,LocalToolJson>;
const initialState:Data={body:{type:'doc',content:[{id:'opening',type:'paragraph',content:[{type:'text',text:'Nadie miró la puerta del norte. Allí esperaba Ωriel.'}]}]}};
const presentation:AnnotationPresentation={label:'Pista narrativa',attributes:{clueKey:'Clave',state:'Estado'},values:{state:{hint:'Insinuada',revealed:'Revelada'}}};
// Author packages export a definition, not a React refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
function ClueNotebook({client,context}:LocalToolProps<Data>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Escena" annotationPresentation={presentation}/>;}
const definition=defineLocalTool<Data>({namespace:'examples.inline-clues',name:{es:'Cuaderno de pistas',en:'Clue notebook'},description:{es:'Pistas narrativas con clave y estado sobre la prosa compartida.',en:'Narrative clues with a key and state in shared prose.'},initialState,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/3',annotation:{id:'story.clue',version:1,attributes:{clueKey:{type:'string'},state:{type:'string',enum:['hint','revealed']}}}}}},preview:{version:1,fields:[{key:'body',label:{es:'Escena',en:'Scene'}}]},document:{defaultTitle:{es:'Cuaderno de pistas',en:'Clue notebook'},embed:'interactive'},validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,component:ClueNotebook});
export default definition;
