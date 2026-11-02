import {defineLocalTool,LocalToolCollaborativeRichEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import {Extension} from '@tiptap/core';
import {Plugin,PluginKey} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
type Data=Record<string,LocalToolJson>;
const sample=Extension.create({name:'writerRichSample',addKeyboardShortcuts(){return{'Mod-Shift-j':()=>this.editor.commands.insertContent('§')};},addProseMirrorPlugins(){return[new Plugin({key:new PluginKey('writerRichSampleDecoration'),state:{init:()=>0,apply:(tr,count)=>count+Number(tr.docChanged)},props:{decorations(state){return state.doc.firstChild?.content.size?DecorationSet.create(state.doc,[Decoration.inline(1,Math.min(2,state.doc.content.size-1),{class:'underline decoration-accent-gold'})]):DecorationSet.empty;}}})];}});
const extensions=[sample];
function Notebook({client,context}:LocalToolProps<Data>){return <LocalToolCollaborativeRichEditor client={client} context={context} field="body" label="Texto compartido" placeholder="Escribe en tu cuaderno…" className="min-w-0" extensions={extensions} editable={context?.canEdit}/>;}
export default defineLocalTool<Data>({namespace:'tests.collaborative-rich',name:{es:'Cuaderno compartido',en:'Shared notebook'},description:{es:'Párrafos y cinco marcas con borrador local y guardado Source.',en:'Paragraphs and five marks with a local draft and Source saving.'},initialState:{body:{type:'doc',content:[]}},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'}}},document:{defaultTitle:{es:'Cuaderno compartido',en:'Shared notebook'}},validateState:(value:LocalToolJson):value is Data=>!!value&&typeof value==='object'&&!Array.isArray(value)&&!!value.body,component:Notebook});
