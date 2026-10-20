# Fichas RPG locales â€” implementaciÃ³n y verificaciÃ³n

## Plan
- [x] Contrato portable, seis presets y mecÃ¡nicas locales con fuentes primarias.
- [x] Editor accesible de atributos, habilidades, recursos y filas; dados e historial.
- [x] Guardado transaccional, conflictos, recuperaciÃ³n e intercambio JSON.
- [x] Pruebas de mecÃ¡nicas, persistencia y flujos de interfaz.

La interfaz no depende del motor nativo de Fiction ni activa modelos. Los valores iniciales son ayudas editables, no personajes completos ni automatizaciÃ³n integral de reglas.

## Fuentes primarias
- D&D SRD 5.2.1: https://www.dndbeyond.com/srd y https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf . Modificador, competencia, habilidades y CD de conjuros; sin textos de clases o bestiario.
- Chaosium, reglas rÃ¡pidas 7e: https://www.chaosium.com/cthulhu-quickstart/ . CaracterÃ­sticas/secundarios: https://cthulhuwiki.chaosium.com/investigators/step-one-investigator-characteristics.html y https://cthulhuwiki.chaosium.com/investigators/step-two-secondary-attributes.html .
- Daggerheart SRD 2.0 (25 agosto 2026): https://www.daggerheart.com/srd/ y https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf . Dados de dualidad, recursos, umbrales y ataque de adversarios (p.85).

Etiquetas mecÃ¡nicas y ayuda original; no se incorporan ilustraciones, personajes, descripciones de conjuros o textos narrativos de los manuales. Las fuentes son enlaces de consulta: no se descargan al usar fichas.

## Entregado

Motor `character-sheets` sin tablas ni servicio. Cada ficha pertenece a `Project.characterSheets`, con revisión propia y edición por borrador. Seis presets: personaje y bloque de estadísticas 5e (SRD 5.2.1), investigador CoC7, personaje y adversario Daggerheart (SRD 2.0), y ficha libre. Etiquetas, características, competencia/pericia, habilidades, recursos, propiedades textuales/numéricas y filas de inventario/conjuros/rasgos/armas/experiencias son editables; hay vínculo opcional al Codex. Se conservan en las copias completas del proyecto y se intercambian como JSON independiente. La importación crea otra identidad y conserva el trabajo abierto si el archivo es inválido.

Cálculos: modificadores 5e, competencia por nivel/CR con override y vuelta al cálculo, habilidades/salvaciones, iniciativa, percepción pasiva y ataque/CD de magia. En CoC se muestran porcentaje, mitad y quinta parte, grados de éxito y objetivo normal/mitad/quinta parte seleccionable, crítico 01 y pifia 100 o 96+ por debajo de 50; se proponen secundarios y solo se aplican mediante confirmación. Referencia oficial adicional: https://downloads.chaosium.com/call-of-cthulhu/cha2300-investigator-sheets/CoC7_Investigator_Sheet_Standard_autocalc.pdf (cara posterior, referencia rápida); nombres y bases de las habilidades de la cara anterior.

Dados d20 con ventaja/desventaja y distinción entre ataques y otros controles; adversarios Daggerheart usan d20 con 20 automático, sin imponer fallo automático de 1. Personajes Daggerheart usan dos d12 diferenciados, éxito con Esperanza/Miedo y dobles críticos. Recursos, daño por umbrales finales, armadura y regla opcional de daño masivo se aplican expresamente. La aplicación de Esperanza/Estrés de una tirada queda marcada para evitar repetirla tras reabrir. Historial de 200 tiradas máximo, dados criptográficos locales y gramática acotada NdS con sumas/restas sin eval. Radar compara atributos del mismo preset, con tabla accesible y escala ajustable.

Guardado: transacción sobre el último Project, revisión por ficha, rechazo de vínculo a otro proyecto, copia como documento nuevo ante conflicto. Journal compartido de borradores y limpieza al borrar el proyecto. Los recursos actuales no se recalculan al cambiar atributos; las sugerencias de CoC son una acción separada.

## Verificación

- `node scripts/run-rpg-sheets-tests.mjs`: 5 grupos, seis presets/JSON, límites de d20 y CoC 49/50, Daggerheart y gramática de dados.
- `node node_modules/electron/cli.js scripts/run-focused-browser-tests.cjs tests/rpg-sheets.browser.tsx testRpgSheets 120000`: 6 grupos; ventana oculta/perfil aislado. Crea, guarda y reabre todos los presets; autoría y tiradas; recursos manuales; concurrencia/copia/recuperación/cancelación; aplicación Daggerheart una sola vez; importaciones y rechazos atómicos.
- ESLint del módulo sin errores. Typecheck global corresponde al gate integrado del proyecto. QA adicional con CSS actual y red desactivada: `scripts/run-rpg-sheets-qa.cjs`, capturas desktop/narrow revisadas en `C:\Users\luism\AppData\Local\Temp\wh-rpg-qa-KhqPxI`. Se corrigió la lista lateral demasiado alta en720px con selector compacto de ficha y ajustes de tirada plegados; sin desbordamiento horizontal.

## Límites explícitos

No se incorporan catálogos de clases, conjuros, monstruos, equipo ni ilustraciones; las filas son del autor. No hay subida de nivel, compras, descansos, combate completo, gasto de Suerte, cordura narrativa, oposición o dados bonus/penalty CoC automatizados. Los umbrales Daggerheart se introducen como valores finales (nivel/equipo incluidos). Las tiradas de dualidad son acciones; para reacciones sin economía de Esperanza/Miedo se usa el control manual de dados. La clasificación CoC presenta las bandas de la tirada estándar; no resuelve todas las excepciones de la mesa. Ni la existencia de presets ni esta prueba constituyen paridad integral de reglas o de todas las funciones de VVD.
