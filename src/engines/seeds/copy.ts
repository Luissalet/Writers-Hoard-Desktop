const es = { reset: 'Restablecer filtros', planting: 'Abrir siembra', payoff: 'Abrir resolución', navigationFailed: 'No se pudieron guardar los cambios antes de abrir el enlace. Reintenta; se conserva el borrador.' };
const en: typeof es = { reset: 'Reset filters', planting: 'Open planting', payoff: 'Open payoff', navigationFailed: 'Your changes could not be saved before opening the link. Try again; your draft is kept.' };
export const getSeedsCopy = (locale: string) => locale === 'es' ? es : en;
