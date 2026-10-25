import {defineLocalTool,type LocalToolJson} from '../sdk';
import {IconNotebook,type IconNotebookState} from './IconNotebook';

/** Import this definition from a trusted source module to use the normal host. */
export default defineLocalTool<IconNotebookState>({
 namespace:'examples.icon-notebook',name:{en:'Icon notebook',es:'Cuaderno de iconos'},
 description:{en:'Choose a local symbol and keep independent notes.',es:'Elige un símbolo local y conserva notas independientes.'},
 document:{defaultTitle:{en:'Icon notebook',es:'Cuaderno de iconos'}},
 initialState:{version:1,iconId:null,notes:''},
 codec:{version:1,fields:{iconId:{kind:'scalar'},notes:{kind:'prose'}}},
 preview:{version:1,fields:[{key:'iconId',label:{en:'Symbol',es:'Símbolo'}},{key:'notes',label:{en:'Notes',es:'Notas'}}]},
 validateState:(value:LocalToolJson):value is IconNotebookState=>!!value&&typeof value==='object'&&!Array.isArray(value)&&value.version===1&&typeof value.notes==='string'&&(value.iconId===null||typeof value.iconId==='string'),
 component:IconNotebook,
});
