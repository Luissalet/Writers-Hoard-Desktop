import {createElement} from 'react';
import {defineLocalTool,defineLocalToolBlock,LocalToolRichProseEditor,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
type Briefing={briefing:string;caption:string};
const initialState:Briefing={briefing:'<p>Write a briefing.</p>',caption:'Local briefing'};
const codec={version:1 as const,fields:{briefing:{kind:'prose' as const,format:'rich' as const},caption:{kind:'scalar' as const}}};
const preview={version:1 as const,fields:[{key:'briefing',label:{en:'Briefing',es:'Informe'}}]};
const validateState=(value:LocalToolJson):value is Briefing=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.briefing==='string'&&typeof value.caption==='string';
// Author packages export a definition, not a React refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
function BriefingEditor({client,context}:LocalToolProps<Briefing>){return createElement(LocalToolRichProseEditor<Briefing>,{client,context,field:"briefing"});}
const definition=defineLocalTool({namespace:'examples.rich-prose',name:{en:'Rich briefing',es:'Informe enriquecido'},description:{en:'Local rich prose with portable previews and explicit saves.',es:'Prosa enriquecida local con lectura portable y guardado explícito.'},document:{defaultTitle:{en:'Briefing',es:'Informe'},embed:'interactive'},initialState,codec,preview,validateState,component:BriefingEditor,blocks:[defineLocalToolBlock({key:'briefing',scope:'host',name:{en:'Rich briefing',es:'Informe enriquecido'},initialState,codec,preview,validateState,component:BriefingEditor})]});

export default definition;
