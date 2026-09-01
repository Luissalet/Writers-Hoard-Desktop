import { makeEntityHook, makeTableOps } from '@/engines/_shared';
import { deleteCodexEntry, updateCodexEntry } from '@/db/operations';
import type { CodexEntry } from '@/types';

const codexEntryOps = makeTableOps<CodexEntry>({
  tableName: 'codexEntries',
  scopeField: 'projectId',
});

export const useCodexEntries = makeEntityHook<CodexEntry>({
  fetchFn: codexEntryOps.getAll,
  createFn: codexEntryOps.create,
  // Igual que el borrado: el renombrado tampoco puede ser un update plano. El
  // nombre del personaje está denormalizado en `relationships` y en
  // `characterArcs`, que es lo que leen la lista de Relaciones, el resolutor de
  // entidades y el índice de búsqueda — así que renombrar aquí dejaba la mitad
  // de la aplicación mostrando el nombre viejo, para siempre.
  updateFn: updateCodexEntry,
  // NO `codexEntryOps.delete`. El borrado plano deja punteros muertos por media
  // aplicación: la relación «Alicia ↔ Bob» seguía saliendo entera y editable en
  // la vista de lista de Relaciones —y desaparecida en la matriz, porque ésa
  // parte de los personajes vivos—, y el id del personaje borrado se quedaba en
  // los pines del mapa, en las imágenes etiquetadas y en cada copia de
  // seguridad. `deleteCodexEntry` (en `db/operations.ts`) ya implementaba la
  // política correcta tabla por tabla —borrar lo que es puro vínculo,
  // DESVINCULAR lo que es texto del autor— pero no la llamaba nadie: era código
  // muerto. Ésta es la única puerta por la que se borra un personaje.
  deleteFn: deleteCodexEntry,
});
