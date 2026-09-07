const es = {
  matrixHint: 'Cada celda reúne todos los vínculos entre dos personajes. Selecciona una para explorar sus matices o crear una relación.',
  pairCount: '{count} relaciones entre {a} y {b}',
  emptyCell: 'Crear una relación entre {a} y {b}',
  pairTitle: '{a} y {b}',
  pairEmpty: 'Todavía no hay vínculos entre estos personajes.',
  addAnother: 'Añadir otro vínculo', closePair: 'Cerrar vínculos del par',
  openCharacter: 'Abrir ficha de {name}', missingCharacter: 'La ficha ya no está disponible',
  noCharacterLink: 'Activa el Códice para abrir la ficha',
  createFailed: 'No se pudo crear la relación. Se conserva lo que has escrito; inténtalo de nuevo.',
  saveFailed: 'No se pudieron guardar los cambios. Reintenta antes de cerrar.',
  deleteFailed: 'No se pudo eliminar la relación. Puedes volver a intentarlo.',
  loadFailed: 'No se pudieron cargar las relaciones o los personajes.',
  retry: 'Reintentar', saving: 'Guardando…', relationCount: '{count} vínculos',
  pastContext: 'Pasada', secretContext: 'Secreta', currentContext: 'Actual',
  negative: '−5 · Hostilidad', neutral: '0 · Neutral', positive: '+5 · Lealtad',
  directionHint: 'Las flechas indican quién se dirige a quién. Los vínculos mutuos aparecen en ambos sentidos.',
};
export type RelationshipsCopy = typeof es;
const en: RelationshipsCopy = {
  matrixHint: 'Each cell gathers every tie between two characters. Select one to explore the details or create a relationship.',
  pairCount: '{count} relationships between {a} and {b}',
  emptyCell: 'Create a relationship between {a} and {b}',
  pairTitle: '{a} and {b}',
  pairEmpty: 'There are no ties between these characters yet.',
  addAnother: 'Add another tie', closePair: 'Close pair relationships',
  openCharacter: 'Open {name} in the codex', missingCharacter: 'This character record is no longer available',
  noCharacterLink: 'Enable the codex to open this record',
  createFailed: 'The relationship could not be created. Your draft is kept; try again.',
  saveFailed: 'Your changes could not be saved. Retry before closing.',
  deleteFailed: 'The relationship could not be deleted. You can try again.',
  loadFailed: 'Relationships or characters could not be loaded.',
  retry: 'Retry', saving: 'Saving…', relationCount: '{count} ties',
  pastContext: 'Past', secretContext: 'Secret', currentContext: 'Current',
  negative: '−5 · Hostility', neutral: '0 · Neutral', positive: '+5 · Loyalty',
  directionHint: 'Arrows show who relates to whom. Mutual ties appear in both directions.',
};
export function getRelationshipsCopy(locale: string): RelationshipsCopy { return locale === 'es' ? es : en; }

export function pairText(template: string, a: string, b: string, count = 0): string {
  return template.replace('{a}', a).replace('{b}', b).replace('{count}', String(count));
}
