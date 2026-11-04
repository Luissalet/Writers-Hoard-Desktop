import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';

type Data=Record<string,LocalToolJson>;
const title={es:'Cuaderno de celdas combinadas',en:'Merged cells notebook'};
const initialState:Data={body:{type:'block-doc',schema:'writers-blocks/11',blocks:[],axisOrder:[]}};

// eslint-disable-next-line react-refresh/only-export-components
function Notebook({client,context}:LocalToolProps<Data>){
 return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label={title.es}/>;
}

const definition=defineLocalTool<Data>({
 namespace:'examples.table-spans',
 name:title,
 description:{es:'Pega celdas combinadas sobre una selección de una tabla compartida.',en:'Paste merged cells over a selection in a shared table.'},
 initialState,
 codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/12',schema:'writers-blocks/11'}}},
 document:{defaultTitle:title,embed:'interactive'},
 validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,
 component:Notebook,
});

export default definition;
