const es = {
  // AI Service
  'ai.disabled': 'Las funciones de IA están desactivadas',
  'ai.proxyNotRunning': 'CLIProxyAPI no está corriendo. Inícialo con: cliproxyapi',
  'ai.unexpectedFormat': 'La IA devolvió un formato inesperado. Inténtalo de nuevo.',

  // AI Features
  'ai.textTooShort.summary': 'El texto es demasiado corto para resumir',
  'ai.textTooShort.characters': 'El texto es demasiado corto para extraer personajes',

  // AI Toolbar
  'ai.loadError': 'Error al cargar el documento',
  'ai.summaryError': 'Error al generar resumen. Inténtalo de nuevo.',
  'ai.charactersError': 'Error al extraer personajes. Inténtalo de nuevo.',
  'ai.characterImportError': 'Error al importar personajes al Codex',
  'ai.characterMergeError': 'Error al fusionar personajes',
  'ai.noCharactersFound': 'No se encontraron personajes en el texto.',
  'ai.conflictWarning': 'Los siguientes personajes ya existen en el Codex. Los datos de la IA se fusionarán con los existentes (los campos vacíos se rellenarán automáticamente).',
  'ai.charactersSelected': 'personaje',
  'ai.charactersSelectedPlural': 'personajes',
  'ai.selected': 'seleccionado',
  'ai.selectedPlural': 'seleccionados',

  // Google Docs Picker
  'docs.loadError': 'Error al cargar documentos',
  'docs.importError': 'Error al importar',

  // Settings - AI
  'settings.ai.title': 'Activar funciones IA',
  'settings.ai.subtitle': 'Resúmenes, extracción de personajes, etc.',
  'settings.ai.requirement': 'Requiere CLIProxyAPI corriendo localmente con una suscripción Claude Max activa.',

  // Dashboard - Full Import
  'dashboard.fullImport.confirm': 'Esto REEMPLAZARÁ todos tus datos actuales con el backup importado. ¿Estás seguro?',
  'dashboard.unsupportedFormat': 'Formato no soportado. Usa un archivo .zip o .json',
} as const;

export default es;
export type TranslationKey = keyof typeof es;
