# ADR-001 — Universo compartido y canon entre proyectos

- Estado: aceptado
- Fecha: 2026-09-07
- Alcance: C1 del informe de remediación integral

## Contexto

Writers Hoard ya representa una saga mediante un `Project` de tipo `saga` y
libros hijos. Lo que falta no es otro contenedor de proyectos, sino una
identidad compartida y explícita para personajes, lugares, objetos, facciones,
reglas, conceptos y eventos que aparecen en varios libros.

Copiar filas de Codex entre proyectos produciría identidades divergentes.
Fusionarlas por nombre sería peor: dos “Ana”, “La Torre” o “el juramento” no
son necesariamente lo mismo. La solución tiene que conservar el origen,
permitir estado local y sobrevivir a que un libro o una entidad local deje de
existir.

## Decisión

### Propiedad

- Se reutiliza el `Project` de tipo `saga` como identidad de serie. No se crea
  otra tabla de series ni una segunda jerarquía.
- La serie posee `SharedCanonEntity`: una identidad neutral con título,
  resumen, tags, tipo, versión y referencia a la fuente que la originó.
- Cada libro posee `SharedEntityBinding`: el vínculo con esa identidad y, si
  procede, un enlace a su entidad local más overrides de título, resumen o
  tags. El contenido completo del libro sigue perteneciendo a Codex, Timeline
  u otro motor; no se copia dentro del canon compartido.

### Identidad y resolución

- Los IDs son opacos y estables. Nunca se deduplican ni fusionan por nombre.
- Una identidad se crea solo mediante una acción explícita sobre una fuente
  local concreta.
- La resolución muestra siempre tres capas: base de la serie, override del
  libro y fuente local. Un override no modifica la base.
- Las escrituras sobre la base usan `expectedVersion`; un cambio concurrente
  produce conflicto visible, nunca last-write-wins silencioso.

### Pertenencia de proyectos

- `parentId` y `children` siguen siendo la relación canónica saga/libro.
- Un libro solo puede pertenecer a una saga a la vez. Cambiarlo de saga retira
  primero la referencia inversa anterior en la misma transacción.

### Borrado

- Borrar un libro elimina únicamente sus bindings por `projectId`; no borra la
  identidad compartida ni otras apariciones.
- Si el libro contenía la fuente de origen, la identidad permanece y se marca
  como origen ausente hasta que el usuario designe otra fuente. No se reasigna
  automáticamente.
- Borrar una saga elimina identidades y bindings de esa saga y separa sus
  libros, pero nunca borra los proyectos hijo ni sus entidades.
- Borrar una identidad compartida exige preview de los bindings afectados y
  un token de confirmación calculado sobre ese preview.

### Promoción al canon de serie

- Promover una entidad local crea una identidad nueva o actualiza una elegida
  mediante preview y versión esperada.
- Nunca se decide por similitud de nombre. Sugerencias futuras pueden mostrar
  candidatos, pero la elección seguirá siendo humana y explícita.

### Backup y restauración

- El ZIP de un proyecto conserva sus `SharedEntityBinding`, incluidos caches
  mínimos de título. Puede restaurarlos aunque la saga no esté presente; en
  ese caso son referencias no resueltas, no contenido recuperable inventado.
- La unidad autoritativa es un archivo de universo compartido versionado que
  contiene el proyecto-saga, identidades, bindings y lista de miembros, pero no
  copia el contenido de los libros.
- Importar ese archivo valida IDs y alcance antes de escribir. Reemplazar una
  saga existente es una opción explícita y transaccional.

## Consecuencias

- Se añaden dos tablas: `sharedCanonEntities` y `sharedEntityBindings`.
- La mayor parte del contenido continúa en los motores existentes; el nuevo
  modelo es identidad, resolución y procedencia, no otro Codex.
- Un backup de proyecto aislado puede mostrar referencias de serie sin tener la
  base disponible. Esa ausencia es un estado honesto y reparable.
- La primera UI puede centrarse en crear identidades, vincular el libro y editar
  overrides. Sincronización automática o merge semántico quedan fuera.

## Alternativas rechazadas

- **Un Codex global compartido:** rompe el ámbito de proyecto y convierte cada
  edición local en una decisión de canon.
- **Copiar entidades entre libros:** pierde identidad y hace imposible saber
  cuál es la fuente vigente.
- **Fusionar por nombre:** introduce falsos positivos irreversibles.
- **Guardar todos los campos de cada motor en JSON genérico:** duplica contenido
  y crea un segundo modelo imposible de validar.
