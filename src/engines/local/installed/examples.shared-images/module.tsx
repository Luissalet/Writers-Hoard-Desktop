import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';

type Data=Record<string,LocalToolJson>;
const paragraph={id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'Imágenes PNG compartidas junto al texto y las tablas.'}]};
const initialState:Data={body:{type:'block-doc',schema:'writers-blocks/5',blocks:[paragraph],axisOrder:[]}};

// eslint-disable-next-line react-refresh/only-export-components
function Notebook({client,context}:LocalToolProps<Data>){
 return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Imágenes compartidas"/>;
}

const definition=defineLocalTool<Data>({
 namespace:'examples.shared-images',
 name:{es:'Cuaderno con imágenes compartidas',en:'Shared image notebook'},
 description:{es:'Imágenes PNG compartidas junto al texto y las tablas.',en:'Shared PNG images alongside text and tables.'},
 initialState,
 codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/6',schema:'writers-blocks/5'}}},
 document:{defaultTitle:{es:'Cuaderno con imágenes compartidas',en:'Shared image notebook'},embed:'interactive'},
 validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,
 component:Notebook,
});

export default definition;
