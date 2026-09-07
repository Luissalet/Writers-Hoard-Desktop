const es = { search: 'Buscar hechos, fechas, etiquetas o fuentes…', noResults: 'No hay hechos que coincidan con esta búsqueda y categoría.', clear: 'Restablecer búsqueda y filtros', results: '{count} hechos encontrados', resultOne: '1 hecho encontrado' };
const en: typeof es = { search: 'Search facts, dates, tags or sources…', noResults: 'No facts match this search and category.', clear: 'Reset search and filters', results: '{count} facts found', resultOne: '1 fact found' };
export const getBiographyCopy = (locale: string) => locale === 'es' ? es : en;
