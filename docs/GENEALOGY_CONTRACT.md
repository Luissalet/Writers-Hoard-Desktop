# Contrato de Genealogía — `hoard.genealogy/1` (v1.0.0)

Estado: implementación de la tarea Ágora #136. El motor Genealogía se registra
en la aplicación, guarda enlaces por proyecto y muestra el árbol SVG con
personajes, relaciones explícitas y exportaciones DOT/texto.

## 1. Capacidades y límites

La pantalla importa carpetas y archivos Markdown al Codex desde Obsidian,
Notion, World Anvil y Campfire. Conserva la fuente completa, convierte el cuerpo
Markdown para el editor y utiliza los tipos explícitos de la exportación. Una
nota sin tipo se guarda como ficha personalizada; no se fusiona por nombre.
Antes de aplicar se muestran añadidos, duplicados, conflictos e incidencias.
La identidad de cada ficha se deriva de proyecto, formato y ruta de origen;
reimportar la misma fuente no la duplica y una fuente cambiada no sobrescribe
automáticamente una ficha existente.

El puente importa también propuestas de enlaces genealógicos desde los cuatro
formatos. Se emparejan personajes por id y las referencias a personajes ya
existentes se resuelven al importar. Las fichas importadas al Codex y los enlaces
genealógicos son operaciones distintas: no se infiere parentesco del texto libre.

Los enlaces viven en Dexie y en las copias del proyecto. El esquema v38 conserva
las referencias y los datos de las instalaciones que ya llegaron a v37, añade
la tabla genealógica y migra las claves antiguas a proyecto+id. Las relaciones
genéricas siguen separadas y no generan ascendencia automáticamente.

El puente IA y MCP ofrecen preview, validate, import, apply, query y undo.
El registro de aplicaciones para undo vive en la sesión del proceso: no se
promete deshacer una aplicación antigua después de reiniciar la app. El sidecar
genealógico y su mapeo de ids se describen abajo; no se modifica el documento
de mundo original para guardar estos enlaces.

## 2. Modelo de datos

### 2.1 Enlace genealógico (`GenealogyLink`)

```ts
interface GenealogyLink {
  id: string;    // único dentro del proyecto; si se duplica, TODAS las ocurrencias se rechazan
  from: string;  // id de personaje (padre en ascendencia; origen en guardian/partner)
  to: string;    // id de personaje (hijo en ascendencia; destino en guardian/partner)
  kind: 'biological_parent' | 'adoptive_parent' | 'guardian' | 'partner';
  label?: string;
}
```

### 2.2 Semántica de `kind`

- `biological_parent` y `adoptive_parent` son **ascendencia**: forman el grafo
  genealógico (padre → hijo). Admiten **padres múltiples** por hijo (biológicos
  y adoptivos coexisten; no se sobreescriben).
- `guardian` y `partner` se aceptan pero **nunca** crean ascendencia.
- Los ciclos se comprueban **solo** sobre el grafo de ascendencia; un ciclo
  mixto adoptivo/biológico es tan inválido como uno biológico.

### 2.3 Relaciones genéricas: preservación sin inferencia

Las relaciones del motor existente (`Relationship`, `src/engines/relationships/types.ts`)
se **preservan verbatim** y **nunca** se interpretan como genealogía: una
relación `family` con etiqueta «madre» NO crea un arco de ascendencia. La
genealogía es un dato explícito y separado; no se infiere de etiquetas.

### 2.4 Identidad

Los personajes se emparejan **solo por `id`**. Nombres, `same_as` o alias
nunca fusionan dos ids.

## 3. Validación (`validateGenealogy`)

Firma: `validateGenealogy(characters, proposal, relationships?) → result`, pura
(sin I/O, sin mutar entradas: copia profunda de todo lo que entra y sale).

Resultado:

```ts
{
  contractVersion: '1.0.0',
  accepted: GenealogyLink[],
  rejected: { link, issues: { code, detail, chain? }[] }[],
  ancestry: { linkId, parent, child, kind }[],   // solo enlaces aceptados de ascendencia
  relationships: unknown[],                       // passthrough intacto
}
```

Códigos de rechazo por enlace (un enlace inválido **no contamina** el resto del lote):

| Código | Cuándo |
|---|---|
| `invalid_shape` | el enlace no es objeto o le falta `id`/`from`/`to`/`kind` como string no vacío |
| `unknown_kind` | `kind` fuera de los cuatro definidos |
| `self_link` | `from === to` |
| `missing_ref` | `from` o `to` no existe entre los ids de personajes |
| `duplicate_id` | el `id` aparece más de una vez en la propuesta (se rechazan todas) |
| `ancestry_cycle` | añadir el enlace cerraría un ciclo de ascendencia; `chain` trae la cadena completa (p. ej. `A->B->C->A`) |

## 4. Intercambio: sidecar sobre `hoard.world/1` intacto

**Problema verificado en el código actual** (`src/services/familyBridge/worldExport.ts:78`,
`worldImport.ts`): hoy el bridge solo traslada `from`, `to`, `type`, `note` y
`since` de cada relación (la etiqueta y el estado se pliegan dentro de `type`/`note`
vía `relationContent`) y **descarta cualquier campo nuevo**. Por tanto, un campo
genealógico aditivo dentro de `Relationship` **no garantiza roundtrip**: se
perdería al exportar/importar. Este lote **no modifica** el bridge; el sidecar
es la vía de intercambio conservadora.

### 4.1 Esquema del sidecar (`hoard.genealogy/1`)

```json
{
  "schema": "hoard.genealogy/1",
  "contractVersion": "1.0.0",
  "links": [ { "id": "f1", "from": "A", "to": "B", "kind": "biological_parent", "label": "..." } ]
}
```

- Viaja **junto a** el documento `hoard.world/1`, nunca dentro: el documento
  mundo se devuelve **intacto como objeto JSON** (mismos campos, mismo orden de
  claves). No se garantiza identidad de bytes: la serialización del receptor
  puede diferir en formato (espacios, orden de propiedades anidadas), y eso no
  cuenta como alteración del documento.
- **Ausencia de sidecar ≠ receptor sin soporte.** Que un documento no traiga
  sidecar solo indica que **no hay datos genealógicos** en él; no demuestra que
  el emisor o el receptor carezcan de soporte. La capacidad debe expresarse de
  forma **explícita** (p. ej. una lista de capacidades del emisor/receptor);
  hasta que ese mecanismo exista, `genealogy_unsupported` solo significa
  «no hay sidecar que leer», y la detección real de soporte queda **pendiente**.
- **Detección explícita de capacidad (implementada):** `genealogySupport(capabilities)`
  en `src/engines/genealogy/sidecar.ts` evalúa un registro de capacidades
  (`{ genealogy: { contractVersion } }`) y devuelve
  `{ supported, contractVersion, reason }` con cuatro motivos: `supported`,
  `no_capabilities` (registro ausente o no objeto), `no_genealogy_capability`
  (sin entrada `genealogy` o sin `contractVersion` válida) y
  `version_unsupported` (versión distinta de la implementada, que se reporta
  sin adivinar). Función pura, sin mutación; cubierta por 5 pruebas.
- Un receptor **sin soporte** de genealogía debe **rechazar explícitamente**
  (`genealogy_unsupported`), no descartar en silencio ni convertir etiquetas
  antiguas: no se pierde ni se degrada ningún dato.
- Un sidecar de versión futura (`hoard.genealogy/2`, …) se rechaza explícitamente
  (`genealogy_version_unsupported`): nunca se adivina un esquema desconocido.
- **Mapeo de ids (implementado en la segunda ronda):** los enlaces del sidecar
  usan los **ids locales** de personaje (`A`, `B`, …), mientras que `hoard.world/1`
  referencia entidades como `hoard://writer/codex/<id>` (`refCodex`,
  `worldSchema.ts:99`). La correspondencia entre ambos espacios la hace
  `mapGenealogyIds(links, idTable, direction)` en
  `src/engines/genealogy/idMap.ts`, con una **tabla de ids explícita** que
  aporta el llamador (local → ref, o invertida con `toLocal`): nunca se adivina
  por nombre. Un extremo fuera de la tabla se rechaza como `missing_ref` con el
  id del enlace; los ids de enlace duplicados se rechazan como `duplicate_id`;
  la tabla con dos locales para la misma ref se rechaza como `invalid_shape`.
  Función pura, sin mutación; cubierta por 9 pruebas
  (`tests/genealogyIdMap.test.mjs`), incluido el ida y vuelta completo.

### 4.2 Errores del sidecar (`GenealogySidecarError`)

| `code` | Cuándo |
|---|---|
| `genealogy_unsupported` | no hay sidecar en el documento (no implica que el emisor/receptor carezca de soporte: ver §4.1) |
| `genealogy_version_unsupported` | `schema` distinto de `hoard.genealogy/1` |
| `genealogy_sidecar_invalid` | sidecar malformado: no objeto, `contractVersion` ausente (una versión distinta es `genealogy_version_unsupported`, ver fila anterior), `links` no array o con entradas no objeto |

## 5. Herramientas del puente IA y MCP

| Herramienta | Operación |
|---|---|
| `wh_genealogy_preview` | Clasifica propuesta contra los enlaces guardados sin escribir. |
| `wh_genealogy_validate` | Valida referencias, clases de enlace y ciclos. |
| `wh_genealogy_import` | Parsea Obsidian, Notion, World Anvil o Campfire y devuelve propuesta y preview; no aplica por sí sola. |
| `wh_genealogy_apply` | Guarda los enlaces aceptados y devuelve rechazos, applyId y revisionAfter. |
| `wh_genealogy_query` | Consulta padres, hijos, tutores y parejas de un personaje. |
| `wh_genealogy_undo` | Deshace los enlaces de una aplicación de la sesión si su revisión no cambió. |

Los errores del handler llegan como fallo del puente, en vez de anunciar una
escritura exitosa. La UI admite además Markdown y usa la misma persistencia
genealógica. No se fusionan identidades por nombre ni se infiere ascendencia
a partir de relaciones genéricas.

## 6. Verificación

La suite de genealogía contiene 242 pruebas Node, incluidas
referencias existentes, ciclos, preview/aplicación, undo y distribución del
árbol; `codex-folder-import.test.mjs` añade 17 pruebas de importación de fichas.
La integración se comprueba además con cuatro migraciones IndexedDB nativas
privadas, llamadas HTTP/MCP reales al puente y el flujo completo de la pantalla
normal de la aplicación. Las pruebas no abren bases de usuario.

```bash
node --experimental-strip-types --test tests/genealogy*.test.mjs
node --experimental-strip-types --test tests/codex-folder-import.test.mjs
```

## 7. Importación de fichas: formato y deshacer

`wh_codex_import_preview`, `wh_codex_import_apply` y `wh_codex_import_undo`
utilizan el mismo importador que la pantalla. Preview y apply reciben projectId,
format y files:[{path,text}]; undo recibe projectId y el applyId devuelto.
Apply guarda todas las fichas nuevas válidas en una transacción. Undo retira
únicamente las fichas de ese recibo, en otra transacción, y conserva todo si
alguna ficha fue modificada después. Los recibos duran la sesión del renderer;
no se ofrece undo de estos recibos después de reiniciar.

Markdown admite metadatos escalares, tags y aliases como listas inline o por
líneas. Los metadatos complejos permanecen en el texto fuente y se informa de
lo que no se ha modelado. JSON admite documentos simples y colecciones
characters, locations, items, factions, concepts, magic, documents y articles.
Esto no certifica todos los archivos nativos o bloques ricos de cada proveedor;
los bloques no modelados se conservan como fuente JSON y se señalan.

Las rutas deben ser relativas a la carpeta seleccionada. Las rutas repetidas,
los documentos vacíos y los archivos malformados se indican en preview;
los documentos válidos del lote siguen disponibles para importar.
