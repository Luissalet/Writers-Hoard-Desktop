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

## Escritura — catálogo de VVD, ola C (Ágora 1095)

Hecho (matriz con pruebas en [tasks/vvd1095/C-writing.md](tasks/vvd1095/C-writing.md):
107 de 113 filas PRESENT, 5 n/a por ser servicios en línea y 1 PARTIAL): menú
«/» con 26 bloques, avisos «leer en voz alta» y recuadro, efectos de texto,
fichas de reglas (hechizo, objeto, criatura) desde propiedades del Códex,
etiqueta de capítulo y capítulos fuera del libro, imagen de cabecera en banda,
estilos de libro con «manual de juego» a dos columnas, páginas de cortesía,
revisión por capítulo y vista por dispositivo, biblioteca de sonidos propia,
cubierta al crear el proyecto y estantería de sagas, fichas del Códex
(selector de tipos, alias, propiedades obligatorias, caras, asistente, tipos
privados, bloques plegables y extraíbles), cronologías (mes bisiesto,
correlación con el gregoriano, re-fechado con deshacer, repeticiones, bandas,
etiquetas, vistas), catálogos de relaciones y tablas con búsqueda, inserciones
y filtros. Todo con interfaz, MCP, deshacer y ámbito de época.

Siguiente, en este orden (ola D1, herramientas de mesa):
- Compendio SRD 5.2 sin conexión (monstruos, conjuros, objetos, estados) con
  «Añadir al mundo» y «Añadir al combate», y el combate en la mesa (iniciativa,
  PG, estados que caducan, salvaciones contra muerte, concentración).
- Bandeja de dados (ventaja, dificultad, 20 y 1 naturales, juegos de dados,
  fórmulas guardadas), generador de nombres (posadas, tiendas, personas,
  pueblos, casas; 13 estilos; «Crear ficha») y lista de tareas.
- Hojas: funciones (SI, SUMAR.SI, BUSCARV…), pestañas de libro e importar y
  exportar .xlsx; después el lienzo (menú contextual, fondos, audio) y el grafo
  (ajustes de vista, grafos guardados).
- Luego las olas D2 (plataforma) y B (campaña).
- La fila C #1 sigue PARTIAL: un proyecto es un solo manuscrito; varias
  historias dentro de un mismo mundo pediría un cambio de modelo.

## Mapas — continuación del catálogo de VVD (Ágora 1095)

Hecho en esta continuación (revisión independiente en rondas, ver
[tasks/vvd1095](tasks/vvd1095/README.md)): aspecto guardado del mundo, mundos en
blanco, áreas y contornos reales a escala, ajustes de viaje del mundo, épocas de
mapa enlazadas a la cronología con reproducción, edición de rótulos con
tiradores, biblioteca de 32 sellos, reproducción del viaje día a día, rejilla
de juego y niebla del lector por capítulos, sucesos de la historia, lente de
comercio, figuras con estilo en los mapas clásicos, selector de fichas que las
crea, menú de clic derecho con comentarios en el punto, cambio de imagen con
proporciones, escala con medidas, lugares reales y leyenda pegada; después,
orden y «quién estaba» en los sucesos con barra para recorrer capítulos y lo
siguiente previsto, caminos con grosor y trazo, lugares bloqueados y
duplicados, lagos que llenan su hondonada, nivel del mar y línea de nieve de
todo el mundo (también en las hojas de comarca), puntos libres y paradas
editables en los viajes y nombres tirados en las lenguas del mundo para los
rótulos; y después el viaje contado en palabras (pueblos, caminos, día y hora,
posadas), terrenos fantásticos, pincel de meseta, banda de vista y curvas de
nivel cada N metros; y la maqueta 3D (bloque con su corte, mesa y sombra; o
paisaje), la piel «Pintado» con rótulos de mapa, iconos de accidentes en 3D y
marcadores con el retrato de su ficha en los mapas de imagen; todo con interfaz, MCP, deshacer y ámbito de época.

Después, en la misma tarea: una sola tierra en su propia hoja plana a su
medida (una isla de 300 km sale con sus ríos y pueblos), zonas con nombre,
volcán y altura en metros, ríos por puntos e invertidos, nubes, bloque de papel
o grabado y árboles de pie en la maqueta, el mapa a una hora con el farol del
grupo, vías propias del mundo, comercio por mar de cada puerto, envíos que
rodean bahías y siguen ríos (también en proyecciones curvas), vista del lector
con tierra a tinta, pueblos como puntos y rastro (también en 3D, y el marco de
la Carta a la vista), y sucesos enlazados a su capítulo y ordenados arrastrando.

Siguiente en mapas (filas ABSENT o PARTIAL de tasks/vvd1095 A1/A2):
- Hoja de ancho × alto distintos y crecer o recortar los bordes después.
- Diseñador de terrenos propios, colores por icono, imagen como cara de un
  lugar, volver a tirar el icono de un lugar y puente por camino.
- Plantilla histórica (Mediterráneo romano), portada del mundo y prueba de
  rendimiento dentro de la app.
- Intensidad del relleno de zonas, ancho por río e icono de cada vía.
- Oleadas posteriores según las listas priorizadas de C-writing, D1-tools,
  D2-platform y B-campaign.

Ninguna fila del catálogo cambia de estado sin un flujo mostrado en interfaz y
MCP; no se declara paridad.
