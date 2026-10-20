const en = {
  title: 'Languages', intro: 'Build a dictionary for each language in your world. Everything stays in this project.',
  newLanguage: 'New language', newWord: 'New word', editLanguage: 'Language settings', editWord: 'Edit word',
  recovered: 'Recovered local draft. Cancel keeps it for later.', recover: 'Recover drafts', discardDraft: 'Discard draft',
  name: 'Language name', description: 'Description', mapping: 'Script mapping', mappingHelp: 'One source=target pair per line, for example sh=š. Longer matches take priority. Leave empty for Latin spelling; a word can override its native form.',
  detection: 'Show word glosses in the manuscript', detectionHelp: 'Hover over a marked word for its meaning. Click to open its dictionary. The manuscript text is unchanged.',
  save: 'Save', cancel: 'Cancel', remove: 'Delete', export: 'Export JSON', import: 'Import JSON', search: 'Search words, meanings and examples',
  emptyLanguages: 'Create a language to collect its words, pronunciation and writing system.', emptyWords: 'Add the first word in this language.', noResults: 'No matching words.',
  word: 'Word', nativeForm: 'Native form override', pronunciation: 'Pronunciation / IPA', partOfSpeech: 'Part of speech', meaning: 'Meanings', examples: 'Examples', phrases: 'Phrases', derivatives: 'Derivatives', origin: 'Origin / etymology', linkedEntryId: 'Related Codex entry', noEntry: 'No linked entry',
  confirmLanguage: 'Move this language and all its words to the archive? You can restore them from Document archive.', confirmWord: 'Delete this word?', error: 'The dictionary could not be saved. Your changes are still here. Try again.', importError: 'The file is not a valid Writer’s dictionary. Check its format and try again.', imported: 'Dictionary imported as a new language.', unsaved: 'Save or cancel the open editor before switching languages.', loading: 'Loading languages…',
};
const es: typeof en = {
  title: 'Idiomas', intro: 'Construye un diccionario para cada idioma de tu mundo. Todo se guarda en este proyecto.',
  newLanguage: 'Nuevo idioma', newWord: 'Nueva palabra', editLanguage: 'Configurar idioma', editWord: 'Editar palabra',
  recovered: 'Borrador local recuperado. Cancelar lo conserva para después.', recover: 'Recuperar borradores', discardDraft: 'Descartar borrador',
  name: 'Nombre del idioma', description: 'Descripción', mapping: 'Correspondencias de escritura', mappingHelp: 'Una pareja origen=destino por línea, por ejemplo sh=š. Las coincidencias más largas tienen prioridad. Déjalo vacío para conservar la escritura latina; cada palabra puede tener su propia forma nativa.',
  detection: 'Mostrar glosas de palabras en el manuscrito', detectionHelp: 'Pasa el cursor sobre una palabra marcada para ver su significado. Haz clic para abrir su diccionario. El texto del manuscrito se conserva.',
  save: 'Guardar', cancel: 'Cancelar', remove: 'Eliminar', export: 'Exportar JSON', import: 'Importar JSON', search: 'Buscar palabras, significados y ejemplos',
  emptyLanguages: 'Crea un idioma para reunir su vocabulario, pronunciación y sistema de escritura.', emptyWords: 'Añade la primera palabra de este idioma.', noResults: 'No hay palabras que coincidan.',
  word: 'Palabra', nativeForm: 'Forma nativa personalizada', pronunciation: 'Pronunciación / AFI', partOfSpeech: 'Categoría gramatical', meaning: 'Significados', examples: 'Ejemplos', phrases: 'Expresiones', derivatives: 'Derivados', origin: 'Origen / etimología', linkedEntryId: 'Ficha del Códice relacionada', noEntry: 'Sin ficha vinculada',
  confirmLanguage: '¿Mover este idioma y todas sus palabras al archivo? Puedes restaurarlos desde Archivo de documentos.', confirmWord: '¿Eliminar esta palabra?', error: 'No se ha podido guardar el diccionario. Tus cambios siguen aquí. Vuelve a intentarlo.', importError: 'El archivo no es un diccionario válido de Writer’s. Comprueba su formato e inténtalo de nuevo.', imported: 'Diccionario importado como un idioma nuevo.', unsaved: 'Guarda o cancela la edición antes de cambiar de idioma.', loading: 'Cargando idiomas…',
};
export const dictionaryCopy = { en, es };
