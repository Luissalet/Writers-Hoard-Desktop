import {defineLocalTool} from '@/engines/local/sdk';
import notebook from '@/engines/local/examples/documentNotebookDefinition';

const qaNotebook=defineLocalTool({...notebook,namespace:'qa.document-notebook1512',name:{en:'QA linked notebook',es:'QA cuaderno vinculado'},description:{en:'Local document navigation QA using the built-in notebook.',es:'Prueba local de navegación con el cuaderno incorporado.'}});
export default qaNotebook;
