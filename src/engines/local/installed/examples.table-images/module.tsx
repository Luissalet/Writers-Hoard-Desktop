import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';

type Data=Record<string,LocalToolJson>;
const paragraph={id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'Coloca imágenes PNG, JPEG y WebP dentro de tablas compartidas.'}]};
const initialState:Data={body:{type:'block-doc',schema:'writers-blocks/8',blocks:[paragraph],axisOrder:[]}};

// eslint-disable-next-line react-refresh/only-export-components
function Notebook({client,context}:LocalToolProps<Data>){
 return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Tablas con imágenes"/>;
}

const definition=defineLocalTool<Data>({
 namespace:'examples.table-images',
 name:{es:'Cuaderno de tablas con imágenes',en:'Notebook with images in tables'},
 description:{es:'Coloca imágenes PNG, JPEG y WebP dentro de tablas compartidas.',en:'Place PNG, JPEG and WebP images inside shared tables.'},
 initialState,
 codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/9',schema:'writers-blocks/8'}}},
 document:{defaultTitle:{es:'Cuaderno de tablas con imágenes',en:'Notebook with images in tables'},embed:'interactive'},
 validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,
 component:Notebook,
});

export default definition;
