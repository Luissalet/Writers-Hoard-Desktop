const es = {
  positive: 'Introduce un número entero de palabras mayor que cero.',
  deadline: 'El objetivo con fecha necesita una cantidad de palabras y una fecha válida.',
  empty: 'Añade al menos un objetivo antes de guardar.',
  failed: 'No se pudieron guardar todos los objetivos. Se conserva el formulario; reintenta para guardar los pendientes.',
  saving: 'Guardando…', date: 'Fecha límite',
};
const en: typeof es = {
  positive: 'Enter a whole number of words greater than zero.',
  deadline: 'A deadline goal needs a word target and a valid date.',
  empty: 'Add at least one goal before saving.',
  failed: 'Some goals could not be saved. Your form is kept; retry to save the remaining goals.',
  saving: 'Saving…', date: 'Deadline date',
};
export const getGoalCopy = (locale: string) => locale === 'es' ? es : en;
