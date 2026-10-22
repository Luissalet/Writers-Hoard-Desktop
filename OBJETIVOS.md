# Objetivos de autoría local

Alcance: continuación de las herramientas locales de mundo documentadas en
[WORLD_AUTHORING](docs/WORLD_AUTHORING.md). Este archivo no sustituye los planes
ni las tareas de otros módulos.

- Completar la integración Git con los hashes revisados y bloqueo de
  integración; QA, manual y documentación ya están completos.
  Conservar los fallos originales y los límites de cada revisión independiente.
- Mantener la misma operación y el mismo ámbito en interfaz y MCP: Base/era,
  propietario, revisiones, recuperación y Deshacer que preserve cambios ajenos.
- Mantener separadas la copia local completa de un proyecto y las coberturas
  parciales de formatos JSON antiguos; documentar cada formato por su evidencia.
- Comprobar instalación y perfil real en su fase propia; el empaquetado en
  directorio, arranque empaquetado y dependencias CPU ya pasan en QA aislada.
- Preparar explícitamente las cachés de modelos opcionales antes de declarar un
  equipo listo para reconocimiento/búsqueda sin conexión.

Las comprobaciones compuestas del código del 21 de octubre pasan: 210 grupos
en 44 suites con 0 fallos, 383 críticos, builds del renderizador/Electron, lint
de entrega sin deuda y conformance (34 motores, 64 tablas, 5650 claves y 22
archivos de idioma). La entrada de producción ocupa 1589.09 kB, por debajo del
límite bloqueante de 1600 kB; siguen los avisos de tamaño lazy/total. El audit
de dependencias de producción registra 0 vulnerabilidades. Pasan 14 pruebas del
servicio nativo de documentos, sin omitidas, el empaquetado en directorio, el
smoke empaquetado y las comprobaciones CPU de dependencias. D3, W01, el perfil
5e acotado, las correcciones M1/M2/M3 de mapas, Archive y herramientas antiguas
tienen dictámenes SHIP independientes dentro de sus contratos revisados.

No es un resultado global de `verify:release`. El audit completo de desarrollo
conserva 13 hallazgos heredados y sigue el aviso de empaquetado de
`resources/bin` opcional. QA, manual y documentación están completos; queda
pendiente la integración Git.
No se certifican instalación, perfil real del usuario ni paridad total.

Pruebas del cierre: [verificación final](tasks/worldcraft1041-final-verification.md)
y `tasks/evidence/worldcraft1041-manual-verification.json` (revisión requerida y
lectura exacta del manual actualizado).

## Mapas — continuación del catálogo de VVD (Ágora 1095)

Hecho en esta continuación (revisión independiente en rondas, ver
[tasks/vvd1095](tasks/vvd1095/README.md)): aspecto guardado del mundo, mundos en
blanco, áreas y contornos reales a escala, ajustes de viaje del mundo, épocas de
mapa enlazadas a la cronología con reproducción, edición de rótulos con
tiradores, biblioteca de 32 sellos, reproducción del viaje día a día, rejilla
de juego y niebla del lector por capítulos, sucesos de la historia, lente de
comercio, figuras con estilo en los mapas clásicos, selector de fichas que las
crea, menú de clic derecho con comentarios en el punto, cambio de imagen con
proporciones, escala con medidas, lugares reales y leyenda pegada, todo con interfaz, MCP, deshacer y ámbito de época.

Siguiente, en este orden:
- Comercio: rutas de envío que rodeen bahías por tierra y usen los ríos; la
  lente también en proyecciones curvas.
- Sucesos: enlace de un suceso a su escena del manuscrito; arrastrar para
  reordenar (hoy flechas antes/después).
- Niebla del lector también en la vista 3D (hoy: Mapa, Carta y exportaciones);
  en la Carta en vivo, dejar a la vista el marco y la cartela (la exportación PNG
  ya los conserva); arranque «tierra a tinta», poblaciones como puntos y rastro.
- Oleadas posteriores según las listas priorizadas de C-writing, D1-tools,
  D2-platform y B-campaign.

Ninguna fila del catálogo cambia de estado sin un flujo mostrado en interfaz y
MCP; no se declara paridad.
