# Radar genérico local

- [x] Contrato portable independiente de las fichas RPG, ejes/series y escalas explícitas.
- [x] Vínculo Codex opcional con campos numéricos vivos y fallback visible.
- [x] Editor, recuperación/CAS, duplicación y SVG/JSON/CSV seguros sin dependencia nueva.
- [x] Pruebas de geometría, límites, importaciones, persistencia, conflictos e interfaz con CSS real.

Fuente competitiva: catálogo oficial https://vvd.crisp.help/en/article/tools-ttd107/ y sesión autenticada. La estructura local de Writer es una implementación propia; no se atribuyen al catálogo reglas de datos que no documenta.

## Entrega

Motor `radar` independiente con documentos `Project.radarCharts`, de 3 a 24 ejes y hasta 32 series. Cada eje tiene identidad estable, nombre, unidad y mínimo/máximo explícitos; moverlo conserva sus valores y vínculos. Cada serie permite nombre/color, visibilidad, valores manuales y vínculo opcional a una ficha Codex del mismo proyecto. Los campos numéricos enlazados se leen vivos sin escribir en la ficha ni en el documento; los valores ausentes/no numéricos muestran su fallback manual y un aviso. Un valor fuera de escala conserva su valor real y recorta solamente la geometría.

El editor muestra gráfico, leyenda y tabla accesible; separa ejes y series en controles comprensibles y conserva una selección compacta en pantallas estrechas. Las escalas no se infieren de los datos: el autor decide cómo comparar. El gráfico RPG reutiliza únicamente la geometría común `src/utils/radar.ts`, sin acoplar los dos documentos ni activar modelos/trabajadores nativos.

Cada guardado usa la última fila del proyecto y compara la revisión del radar. Conflictos/fallos mantienen el borrador recuperable y permiten guardar una copia o recargar. Cambiar de documento y reabrir conservan cambios sin guardar, incluso escalas temporalmente incompletas. Borrar exige confirmación y usa el archivo recuperable compartido; cancelar conserva la edición. El inventario cuenta documentos sin añadir tablas Dexie. Copia/backup del proyecto incluye sus metadatos; el clonador remapea la identidad del gráfico y los punteros Codex.

JSON conserva el documento portable y permite importarlo con identidad independiente. CSV guarda los valores actuales resueltos como snapshot, con cabeceras, escalas/unidades, comillas y saltos de línea; las etiquetas que parecen fórmulas se protegen. SVG es un archivo autónomo del gráfico visible, con colores validados y texto/XML escapados, sin recursos remotos. Importaciones erróneas no sustituyen la edición actual; vínculos ausentes o ajenos se limpian al importar. CSV no conserva vínculos vivos ni estilos completos: JSON es el formato de ida y vuelta.

Archivos: `src/engines/radar/{types,model,operations,interchange,RadarEngine,RadarEditor,RadarGraphic}.ts(x)`, traducciones propias, `src/utils/radar.ts`, registro de motores y limpieza compartida de borradores. No se añadió dependencia.

## Verificación

- `node scripts/run-radar-tests.mjs`: 5 grupos; normalización, límites, identidades, escalas inválidas recuperables, ámbito de campos vivos, fallback, JSON independiente, CSV seguro y SVG sin contenido activo.
- Electron oculto `tests/radar.browser.tsx testRadarCharts`: 6 grupos; autoría Unicode/guardado/reapertura, actualización viva sin escrituras, reordenación, borrador incompleto, conflictos con copia, importaciones independientes/errores y borrar/restaurar desde archivo.
- `scripts/run-radar-qa.cjs`: CSS real de la aplicación, 1440×1000 y 720×960, sin desbordamiento horizontal; capturas inspeccionadas en `C:\Users\luism\AppData\Local\Temp\wh-radar-qa-gklu4g` (`radar-series-desktop.png`, `radar-axes-desktop.png`, `radar-narrow.png`).
- ESLint de los módulos Radar, geometría y consumidor RPG sin errores. Conformance global: 34 motores, 63 tablas, 5618 claves, 22 archivos de idioma, 0 avisos.
- El agente de archivo comprobó por separado restauración del radar, conflicto de identidad ocupada y dependencia Codex; su conjunto pasa 8 grupos.

No se implementan expresiones arbitrarias ni consultas de red en los valores vivos. Las comparaciones representan datos definidos por el autor, sin interpretar reglas de juegos ni corregir escalas silenciosamente.
