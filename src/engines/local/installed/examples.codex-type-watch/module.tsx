import {defineLocalTool,type LocalToolJson} from '../../sdk';
import TypeWatch from './TypeWatch';

export type TypeWatchState=Record<string,never>;
const definition=defineLocalTool<TypeWatchState>({
 namespace:'examples.codex-type-watch',
 name:{en:'Codex type catalogue',es:'Catálogo de tipos del Códex'},
 description:{en:'Follow the effective schema and appearance of the project’s Codex types.',es:'Consulta las propiedades y la apariencia de los tipos del Códex del proyecto.'},
 document:{defaultTitle:{en:'Codex types',es:'Tipos del Códex'}},
 initialState:{},
 validateState:(value:LocalToolJson):value is TypeWatchState=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0,
 component:TypeWatch,
});
export default definition;
