import {defineLocalTool} from '../sdk';
import notebook from './linkedNotebookDefinition';
export default defineLocalTool({...notebook,namespace:'examples.document-notebook',name:{en:'Document notebooks',es:'Cuadernos documentales'},document:{defaultTitle:{en:'Untitled notebook',es:'Cuaderno sin título'}}});
