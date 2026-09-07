/** Copy stays injectable and bilingual while this surface evolves independently. */
const es = {
  capture: 'Captura una idea…', add: 'Añadir idea', branch: 'Ramificar',
  branchHint: 'Crear una idea conectada a la selección',
  emptyTitle: 'Una idea es suficiente para empezar',
  emptyBody: 'Anota lo que tienes en mente. Después conecta posibilidades, reúne ideas en grupos y explora qué ocurre a continuación.',
  emptyHint: 'Doble clic en el lienzo para crear · Mayús + arrastrar para seleccionar',
  branchFrom: 'Conectada con', close: 'Cerrar panel', saveRetry: 'Reintentar guardado',
  loading: 'Abriendo tus ideas…', group: 'Agrupar', search: 'Buscar ideas y conexiones',
  surface: 'Superficie', cork: 'Corcho', slate: 'Pizarra', grid: 'Papel', blueprint: 'Plano',
};
export type BoardCopy = typeof es;
const en: BoardCopy = {
  capture: 'Capture an idea…', add: 'Add idea', branch: 'Branch out',
  branchHint: 'Create an idea connected to the selection',
  emptyTitle: 'One idea is enough to begin',
  emptyBody: 'Write down what is on your mind. Then connect possibilities, gather ideas into groups and explore what happens next.',
  emptyHint: 'Double-click the canvas to create · Shift + drag to select',
  branchFrom: 'Connected to', close: 'Close panel', saveRetry: 'Retry saving',
  loading: 'Opening your ideas…', group: 'Group', search: 'Search ideas and connections',
  surface: 'Surface', cork: 'Cork', slate: 'Slate', grid: 'Paper', blueprint: 'Blueprint',
};
export function getBoardCopy(locale: string): BoardCopy { return locale === 'es' ? es : en; }
