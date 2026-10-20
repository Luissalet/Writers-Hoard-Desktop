# Subtipos y defaults heredados

- [x] Verificar jerarquía/defaults por tipo en documentación primaria VVD.
- [x] Contrato de padre, resolver puro, overrides de campos/referencias y cuerpo heredado/propio.
- [x] Guardas de ciclos/categorías y retirada transaccional conservando hijos/defaults/fichas.
- [x] UI de padre/overrides, rutas y filtros jerárquicos, referencias limitadas a subtipo y descendientes.
- [x] Pruebas de tres niveles, blancos/tipos, transacciones, manager, creación y filtros.

Fuente: https://vvd.crisp.help/en/article/card-types-templates-44at3z/ (actualizada 21 septiembre2026) confirma organización tipos/subtipos, defaults de propiedades/bloques y sincronización opcional. No explicita política de herencia. Las reglas de Writer son deliberadas: default heredado salvo override propio; cuerpo puede heredar o reemplazar incluso vacío; nuevas fichas reciben defaults y las existentes conservan sus datos. No se implementa sincronización destructiva masiva.

Metadatos: `CodexTemplate.parentTemplateId?`, `contentMode?: inherit|replace`; `ReferenceFieldDefinition.targetTemplateId?`. Resolver puro sin DB en `templateHierarchy.ts`, utilizado por las vistas que necesitan nombres/definiciones efectivos. Retirar un padre pliega solo esa capa de defaults en sus hijos y conserva herencia de antecesores. No modifica filas Codex existentes.

Verificado: Electron oculto `tests/codex-template-hierarchy.browser.tsx testCodexTemplateHierarchy` cinco grupos verdes; `tests/codex-templates.browser.tsx testCodexTemplates` mantiene cuatro grupos; ESLint de módulos editados sin errores. Remapeo de identidades/HTML en importación y gate global se coordinan en la raíz. Colores/iconos/orientación/ocultar selectores permanecen como metadatos visuales independientes cuando se implementen.
