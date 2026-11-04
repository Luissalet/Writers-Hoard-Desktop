import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';

type Data=Record<string,LocalToolJson>;
const paragraph={id:'P',type:'paragraph',attrs:{},parentId:null,slot:'body',afterId:null,content:[{type:'text',text:'Imágenes PNG, JPEG y WebP con tamaño y alineación independientes.'}]};
const initialState:Data={body:{type:'block-doc',schema:'writers-blocks/7',blocks:[paragraph],axisOrder:[]}};

// eslint-disable-next-line react-refresh/only-export-components
function Notebook({client,context}:LocalToolProps<Data>){
 return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Imágenes compartidas"/>;
}

const definition=defineLocalTool<Data>({
 namespace:'examples.image-formats',
 name:{es:'Cuaderno de imágenes PNG, JPEG y WebP',en:'PNG, JPEG and WebP notebook'},
 description:{es:'Imágenes PNG, JPEG y WebP con tamaño y alineación independientes.',en:'Shared PNG, JPEG and WebP with independent size and alignment.'},
 initialState,
 codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/8',schema:'writers-blocks/7'}}},
 document:{defaultTitle:{es:'Cuaderno de imágenes PNG, JPEG y WebP',en:'PNG, JPEG and WebP notebook'},embed:'interactive'},
 validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,
 component:Notebook,
});

export default definition;
