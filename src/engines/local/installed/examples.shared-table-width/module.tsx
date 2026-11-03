import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';

type Data=Record<string,LocalToolJson>;
const paragraph={id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'Tablas con ancho de columna compartido.'}]};
const initialState:Data={body:{type:'block-doc',schema:'writers-blocks/4',blocks:[paragraph],axisOrder:[]}};

// eslint-disable-next-line react-refresh/only-export-components
function Notebook({client,context}:LocalToolProps<Data>){
 return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Ancho de columnas compartidas"/>;
}

const definition=defineLocalTool<Data>({
 namespace:'examples.shared-table-width',
 name:{es:'Cuaderno con ancho de columnas',en:'Column width notebook'},
 description:{es:'Tablas con ancho de columna compartido.',en:'Tables with shared column widths.'},
 initialState,
 codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/5',schema:'writers-blocks/4'}}},
 document:{defaultTitle:{es:'Cuaderno con ancho de columnas',en:'Column width notebook'},embed:'interactive'},
 validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,
 component:Notebook,
});

export default definition;
