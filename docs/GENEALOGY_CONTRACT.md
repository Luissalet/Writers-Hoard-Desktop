# Contrato de Genealogía — `hoard.genealogy/1` (v1.0.0)

> Estado: **lote parcial en revisión** — tarea Ágora #136. Este lote entrega el
> contrato, el validador puro y las pruebas. **No** entrega la UI del árbol
> genealógico, ni importadores Markdown, ni cambios en el bridge existente.
> La tarea #136 completa sigue abierta: queda una segunda ronda tras esta revisión.

## 1. Alcance de este lote

| Entregado | Pendiente (declarado) |
|---|---|
| Contrato versionado (este documento) | Vista de árbol genealógico (W3, UI) |
| Validador TS puro `src/engines/genealogy/validate.ts` | Importadores WorldAnvil/Campfire (resto de W6) |
| Importador Markdown `src/engines/genealogy/markdownImport.ts` (W6, primera pieza) | Persistencia Dexie de enlaces genealógicos |
| Importador Obsidian `src/engines/genealogy/obsidianImport.ts` (W6, segunda pieza) | |
| Importador Notion `src/engines/genealogy/notionImport.ts` (W6, tercera pieza) | |
| Importador World Anvil `src/engines/genealogy/worldAnvilImport.ts` (W6, cuarta pieza) | Importador Campfire (resto de W6) |
| Mapeo de ids `src/engines/genealogy/idMap.ts` (segunda ronda) | Contrato MCP real (`preview/validate/apply/query/undo`) |
| Pruebas Node estándar `tests/genealogy.test.mjs` (25) | Migración/roundtrip real en el bridge |

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

## 5. Contrato MCP propuesto (NO implementado aún)

Propuesta de herramientas futuras para el puente IA, con límites explícitos:

| Herramienta | Entrada | Salida / límites |
|---|---|---|
| `genealogy_preview` | propuesta de enlaces | resultado de `validateGenealogy` (aceptados/rechazados con cadenas de ciclo); **solo lectura** |
| `genealogy_validate` | propuesta de enlaces | igual que preview; sin efectos |
| `genealogy_apply` | propuesta validada | aplica solo los aceptados; rechaza el lote si algo cambió desde el preview (ver undo) |
| `genealogy_query` | id de personaje | padres, hijos, guardianes, pareja; nunca infiere de relaciones genéricas |
| `genealogy_undo` | id de aplicación | **exigirá revisión actual**: solo deshace si el registro no fue modificado desde la aplicación (hash de revisión), para no pisar cambios ajenos |

Límites: sin inferencia, sin fusión por nombre, sin borrado de datos, sin
escritura fuera de los enlaces propuestos. Nada de esto existe todavía en el
bridge; se declara como diseño pendiente de la segunda ronda.

## 6. Verificación

```bash
node --experimental-strip-types --test tests/genealogy.test.mjs
# 25 pruebas: aceptación/rechazo exactos (f1,f2,f3,f6,f7 / f4,f5,f8,f9),
# ciclo mixto, no mutación, padres múltiples, genérica fuera del grafo,
# ids duplicados, sidecar intacto y rechazos explícitos (versión, ausencia
# de contractVersion, links malformados), ids locales vs refs hoard.
```

Ejecución registrada en este lote: **25/25 pass, `NODE_EXIT=0`** (Node v22.19.0,
`--experimental-strip-types`), y **`TSC_EXIT=0`** con el compilador estricto del
proyecto (`--strict --noEmit --allowImportingTsExtensions`). Antes de la
implementación, la batería fallaba con `ERR_MODULE_NOT_FOUND` (módulo
inexistente), como prueba de que las pruebas ejercen el código real.
