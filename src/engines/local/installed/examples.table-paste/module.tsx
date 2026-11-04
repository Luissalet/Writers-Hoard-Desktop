import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';

type Data=Record<string,LocalToolJson>;
const paragraph={id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'Paste a table from the clipboard into a cell or a selection.'}]};
const initialState:Data={body:{type:'block-doc',schema:'writers-blocks/10',blocks:[paragraph],axisOrder:[]}};

// eslint-disable-next-line react-refresh/only-export-components
function Notebook({client,context}:LocalToolProps<Data>){
 return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Table paste"/>;
}

const definition=defineLocalTool<Data>({
 namespace:'examples.table-paste',
 name:{es:'Cuaderno de pegado en tablas',en:'Table paste notebook'},
 description:{es:'Pega celdas con texto y cabeceras en tablas compartidas.',en:'Paste cells with text and headers into shared tables.'},
 initialState,
 codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/11',schema:'writers-blocks/10'}}},
 document:{defaultTitle:{es:'Cuaderno de pegado en tablas',en:'Table paste notebook'},embed:'interactive'},
 validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,
 component:Notebook,
});

export default definition;
