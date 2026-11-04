import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';

type Data=Record<string,LocalToolJson>;
const initialState:Data={body:{type:'block-doc',schema:'writers-blocks/9',blocks:[],axisOrder:[]}};

// eslint-disable-next-line react-refresh/only-export-components
function Notebook({client,context}:LocalToolProps<Data>){
 return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Table layout"/>;
}

const definition=defineLocalTool<Data>({
 namespace:'examples.table-layout',
 name:{es:'Cuaderno de diseño de tablas',en:'Table layout notebook'},
 description:{es:'Ajusta la altura de las filas y el ancho de las columnas en tablas compartidas.',en:'Adjust row heights and column widths in shared tables.'},
 initialState,
 codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/10',schema:'writers-blocks/9'}}},
 document:{defaultTitle:{es:'Cuaderno de diseño de tablas',en:'Table layout notebook'},embed:'interactive'},
 validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,
 component:Notebook,
});

export default definition;
