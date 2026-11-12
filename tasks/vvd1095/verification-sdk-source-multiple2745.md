# Añadir varios campos a un documento Source

En la definición nueva, usa `sourceAdditive: { from, fields: { habitat: 'Coast', threat: 4, traits: [], stats: {} } }` con los descriptores correspondientes. `from` identifica el codec y el esquema exactos del predecesor. Los campos existentes conservan sus descriptores. Esta declaración admite escalares, mapas vacíos y listas vacías con IDs estables. [SDK local](../../docs/local-tool-sdk.md#add-several-fields-in-one-source-release)

Seleccionar la versión y abrir el documento muestra los valores por defecto sin guardarlos. La primera tanda efectiva conserva el origen y guarda una sola revisión. Deshacer quita las escrituras propias y vuelve a mostrar los valores por defecto. Usa las acciones del SDK o `wh_local_tool_state_apply` y el Deshacer habitual. La sección inferior documenta las adiciones sucesivas. Para el cambio de nombre de un campo escalar, consulta [la migración explícita](#migrar-un-escalar-a-un-nombre-nuevo).

## Verificación

- Brave ejecutó el SDK oficial de VVD sobre un documento antiguo sintético. La versión anterior escribió un nombre. La nueva leyó dos escalares, una lista vacía y un mapa vacío con el mismo esquema y cero eventos de actualización en la lectura. Después escribió sólo un escalar. [Demo oficial](https://docs.vvd.world/workshop/guides/storing-data#edit-the-shape-and-watch-it-change)
- Writer rechazó la declaración múltiple antes del cambio. Brave r2 pasó 20 comprobaciones con seis campos, incluidas escrituras dispersas, un Deshacer, dos autores, entrega parcial de dos listas y reapertura. Pasaron además las regresiones de escalar, mapa, lista, entrega parcial e historial físico del formato anterior.
- Puente real Native. Dos claves y 22 llamadas MCP verificaron lectura pasiva, promoción, Deshacer, ámbito de era y Base intacta. Dos revocaciones dieron 401 sin IPC, las sesiones terminaron con EOF 0 y quedaron 89 tablas privadas vacías. El perfil y los bundles de prueba se retiraron. Quick y build r2 finalizaron con EOF 0.

La revisión 1 de #2745 aprobó `f755eba9b2d8c6f492659dab98f93db6e95d044e`, integrado por fast-forward. El manual de Google recoge la transición. Recibos en `Research/writer-parity-20261110/sdk-additive-multiple`.

## Encadenar ampliaciones desde otra versión aditiva

La versión V3 declara el predecesor exacto V2 en `from`. Para abrir directamente los documentos de V1, incluye V1 en `ancestors`. Cada identidad contiene `namespace`, `codec`, `validationId` y `schemaEpoch`. Declara sólo los campos nuevos en `fields` y conserva los descriptores de los anteriores. El nuevo codec proyecta los defaults de ambas etapas.

La lectura y una operación sin cambios dejan intacto el checkpoint de V1 o V2. La primera edición de V3 conserva el origen y los cambios de V2. Registra las fronteras necesarias junto a la escritura en una sola revisión. Deshacer conserva los cambios anteriores y recupera la ausencia de los campos recién escritos. Pin comprueba el historial retenido. El formato no autoriza cambios de tipo ni migraciones no aditivas.

El SDK oficial de VVD en Brave probó V1→V3 y V1→V2→V3, sin eventos de actualización al leer. Writer reprodujo el límite anterior y pasó 29 comprobaciones de la referencia y 22 de listas en dos etapas. Probó ausencia de escritura, pin inválido, frío, Deshacer y entregas parciales en ambos órdenes. Siete regresiones incluyeron historial físico y copias. Native r3 pasó 31 llamadas MCP con dos claves. Quick y Build r3 EOF 0.

La revisión 1 de #2777 aprobó `6d298436f0f1bd579042f08f1e3620cde9c1a49d`, integrado por fast-forward. El manual de Google describe ambas rutas. Recibos en Research/writer-parity-20261110/sdk-additive-successive.

## Leer los campos de una etapa anterior

Con V3 activa, `convergence.readAs(identityHash)` devuelve los campos acreditados de V1 o V2 a partir del dato actual. `wh_local_tool_read` admite el mismo `readAs` con `documentId`. Para la etapa inmediatamente anterior, consulta `fromHash` del codec que muestra `wh_local_tool_describe`. Los campos de V3 quedan fuera de la vista anterior y sus ediciones de campos compartidos siguen visibles.

La respuesta incluye las dos identidades, el ámbito, un indicador de conflicto y el dato admitido. La proyección no cambia la versión seleccionada, los bytes ni el historial. El escritor usa la lectura normal del estado activo.

Brave RED confirmó que faltaba el método. Brave GREEN pasó 46 comprobaciones de referencia y 36 de dos listas. El caso de conflicto devuelve el dato admitido. También pasaron las regresiones de ampliación múltiple, entregas parciales y archivos. Native r3 pasó 39 llamadas MCP con dos claves, incluido el ámbito heredado de una era. Quick y Build r3 EOF 0. El SDK de navegador y el host en memoria rechazan estados que cumplen el codec pero incumplen el validador activo. Las copias mantienen la validación portátil. La revisión 1 de #2839 aprobó `7ff7d4a0e50fecc7b8faaea55e2604ba551a5cd1`, integrado por fast-forward. El manual de Google describe esta lectura.

## Editar los campos de una etapa anterior

Con V3 activa, `state.apply(baseline, actions, { asIdentity })` admite un hash acreditado de V2. El puente acepta `asIdentity` en `wh_local_tool_state_apply`. Parte de una lectura normal exacta de V3 y limita la tanda a campos de V2. Los campos más nuevos conservan sus valores y el recibo normal permite Deshacer la tanda. Una era que todavía hereda Base rechaza este selector antes de crear una variante.

El SDK oficial permitió escribir hábitat y armadura desde V2 con V3 activa. Brave RED reprodujo la falta de la restricción de etapa en Writer. Brave GREEN pasó 60 comprobaciones focales y 50 con dos listas. Native r3 pasó 51 llamadas MCP con dos claves. Verificó estado exacto, rechazo de una lectura obsoleta, repetición sin revisión, Deshacer y era heredada sin materializar. Quick y Build r3 terminaron con código 0. Revisión 2 de #2845 aprobó `0e960dda15d3828d73a528d97998b050069e38f7`, integrado por fast-forward.

## Usar etapas declaradas en un documento nuevo

Después de guardar en V3, el mismo documento puede leer y editar campos de V2 aunque haya nacido directamente en V3. Writer valida el checkpoint activo y usa la etapa aditiva declarada por la versión seleccionada. La lectura devuelve `stageInHistory: false` si esa etapa sólo está declarada. Para una etapa que aparece en el historial físico devuelve `true`. El historial sólo registra etapas recorridas. La edición sigue usando la lectura activa y conserva los campos de V3. Puede deshacerse con el recibo normal.

La demo ejecutable de VVD mostró cero updates de lectura y dos al editar hábitat y armadura con V2. Brave Writer pasó 55+45 con documento nuevo, 60+50 de escritura anterior y regresiones 20/67/27. Native r1 pasó 59 llamadas MCP con dos claves y conservó la identidad y la lista de V3. Quick y Build r1 terminaron con código 0. La revisión 1 de #2896 aprobó `5a23efd117f9c456d8829d07614672de4a0f0453`, integrado por fast-forward.

## Migrar un escalar a un nombre nuevo

La versión seleccionada puede declarar `sourceScalarRename` con el contrato exacto anterior y un cambio de nombre de campo. Ambas versiones usan codec 1 y motor de convergencia 1. Esta declaración es incompatible con `sourceAdditive` y `richAdoption`. La lectura proyecta el dato validado. `convergence.start(snapshot, { migrate: true })` o `wh_local_tool_convergence_start` con `migrate: true` aplica la migración a la revisión leída. El nuevo estado conserva ID y campos vecinos, usa la vista previa actual y guarda la raíz anterior en Historial. Una era heredada conserva la lectura hasta que tenga una variante propia.

La demo de VVD ejecutó el callback al invocarlo. Su host de ensayo no lo llamó al abrir V1.1. Writer RED reprodujo `invalid-state` en el pin normal. Brave GREEN pasó 30 comprobaciones, incluidas vista previa, versión de origen, opción capturada, CAS y ámbitos. Native r4 pasó 23 llamadas MCP con dos claves y conservó la raíz anterior. Quick y Build r4 terminaron con código 0. Revisión 1 de #2913 aprobó `a25d759f7601be3150424df36c90eaa0e0710d78`, integrado por fast-forward.

## Transformar el estado Source con un callback

La versión declara `sourceMigration: { from, migrate }`. `from` identifica el predecesor exacto. En el caso de mapa a lista, ambas versiones usan codec 1 y motor de convergencia 1 y cambian de forma. El callback síncrono transforma una copia del JSON anterior. El validador y el codec de destino comprueban el resultado. La selección y la lectura pueden ejecutar el callback sin guardar. `convergence.start(snapshot, { migrate: true })` y `wh_local_tool_convergence_start` comprueban la lectura vigente y guardan la nueva forma en una revisión. Se conserva el ID y la raíz anterior queda en Historial. Una era heredada puede crear su variante en el codec anterior y migrarla por la vía explícita.

La demo oficial de VVD convirtió el mapa en una lista mediante un callback y una actualización. Writer RED #2917 reprodujo el rechazo por la ruta normal. La revisión detectó además un guardado genérico que permitía convertir el documento heredado sin la operación explícita. Brave GREEN pasó 48 comprobaciones y las regresiones de renombrado y etapas aditivas. Native registró 41 llamadas MCP con dos claves, incluidas raíces ocultas y archivadas y la conservación del contrato causal al recuperar una raíz iniciada. Quick y Build terminaron con código 0. Fuente integrada `2426e8971c0991931b2cb50625018fb465e8ab8e`.

## Migrar valores Source con el mismo codec

`sourceMigration` admite el mismo codec si cambia `stateSchemaVersion`. El checkpoint acredita la identidad exacta de origen o destino. La versión nueva puede mostrar el dato transformado sin guardarlo. La migración explícita usa la lectura vigente y conserva ID, hash de codec y raíz previa. Guarda otro validationId, schemaEpoch y génesis. Una raíz sin checkpoint puede iniciar el estado de la versión seleccionada por la vía normal. La solicitud de migración requiere que pueda acreditarse la versión anterior.

VVD transformó Draft: Storm en Storm con una sola actualización. Writer RED #2928 cambió la identidad en el inicio normal y conservó el dato anterior. Brave GREEN pasó 21 comprobaciones, incluidas raíz ambigua, época no declarada, historia y variantes. Native registró 31 llamadas MCP con dos claves, y Quick y Build terminaron con código 0. Fuente integrada `4b8c15a0d44485012377bd411364040d1c154708`.
