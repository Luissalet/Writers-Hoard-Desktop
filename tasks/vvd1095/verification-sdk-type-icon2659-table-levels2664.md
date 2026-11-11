# Más niveles de agrupación e iconos de tipo en el SDK

## Agrupar por más de dos columnas

Writer admite una regla por columna distinta disponible, con dirección independiente y plegado por rama. Al quitar un nivel intermedio se mantienen las reglas restantes en su orden. La configuración se guarda por tabla y ámbito Base/era. El plegado sigue siendo de sesión. [Agrupación persistida](verification-table-grouping-persistence2656.md) · [Filtros y orden](verification-table-view-persistence2658.md)

- **Referencia VVD.** Brave 3 mostró cuatro niveles, Sworn to → People → Hold → Souls, y direcciones independientes en el ejemplo público. Quitar People conservó los otros tres. El ensayo no estableció el máximo de niveles ni verificó recarga en una tabla de mundo. [Tabla pública de VVD](https://beta.vvd.world/tools/table)
- **Writer, Source 2664.** Brave 3 guardó Region → People → Hold → Souls en una tabla normal, con 1200 antes de 900 en la rama Grey. Buscar High Oak Ω encontró 1/1 y abrió la rama plegada. Tras recargar, quitar People y volver a recargar, quedaron Region → Hold → Souls y la última dirección descendente. Una tabla viva de Character recuperó cuatro niveles tras recarga. `BRAVE2664-r2.md` (`589c8ae5`).
- **Proyección focal.** Cinco casos pasaron, incluido uno de 6000 niveles importados que evita recorrerlos con la pila de JavaScript. Ese caso se ejecutó sin DOM. La prueba en Brave llegó a cuatro niveles, sin medir el rendimiento de tablas extremas ni verificar archivos de exportación. Focal, Quick y build terminaron con EOF 0. `FOCAL2664-r2.log` (`702fd8f9`), `QUICK2664-r2.log` (`44d08c7a`), `BUILD2664-r2.log` (`100b5668`).

La revisión CAS 1 aprobó `9ee366116401fb23055f767409e114d3662dd82b`. Se integró en Main por fast-forward sin push. Recibos en `Research/writer-parity-20261110/tables-more-group-levels`. Vistas nombradas, agregados y orden manual de la vista viva (C95) siguen abiertos.

## Icono de tipo del Códex en el SDK

`LocalToolCodexTypeIcon`, exportado desde `@writers-hoard/local-sdk`, dibuja el icono y el color efectivos de la fila de catálogo recibida. Un icono ausente o desconocido usa el de la categoría y, si falta el color, se usa también el de la categoría. El icono es decorativo por defecto y acepta una etiqueta accesible mediante `label`. El ejemplo `examples.codex-type-watch` usa la exportación pública. [Catálogo observable de tipos](verification-sdk-codex-types2644.md) · [Guía del SDK](../../docs/local-tool-sdk.md)

- **Referencia VVD.** La documentación describe `types.renderIcon`. En el laboratorio público con catálogo vacío, las cuatro consultas devolvieron vacío sin error. El ensayo no acreditó la apariencia de un tipo real. [Referencia SDK de VVD](https://docs.vvd.world/workshop/reference/sdk#hostservices)
- **Writer, Source 2659.** Brave 3 instaló y fijó un paquete compilado que importa sólo React y el SDK público. Verificó fallback por categoría, etiqueta accesible, estado decorativo y color personalizado con una fila de prueba. Un tipo hijo real del proyecto sintético heredó Sword → Shield al guardar el padre en otra pestaña, mantuvo Shield tras recarga y también lo mostró en el ejemplo. `BRAVE2659-r1.md` (`5a8a40e8`).
- **Corrección final.** Brave 3 con el paquete 0.1.2 confirmó que `constructor` y `__proto__` usan los iconos de categoría, que `Plane` sigue cargándose desde el catálogo completo y que el hijo conserva Shield. Quick y build r2 terminaron con EOF 0. `BRAVE2659-r2.md` (`084e7a75`), `QUICK2659-r2.log` (`9547146e`), `BUILD2659-r2.log` (`08934e60`).

La revisión CAS 2 aprobó `7c7d2204b7d103a6b766d91d30c7ea293752c5e4` y `62941cf1ef27401f712f9ced27c81f2b81858f9e`. Se integraron en Main por fast-forward sin push. Recibos en `Research/writer-parity-20261110/sdk-codex-type-icon`. El renderer usa la fila recibida y no amplía el acceso a tipos.
