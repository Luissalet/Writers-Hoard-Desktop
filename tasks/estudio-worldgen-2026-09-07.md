# Worldgen: estudio y reestructuración

## Diagnóstico

Worldgen combina generación planetaria, detalle regional, cartografía, vista 3D, escultura y herramientas narrativas. La principal necesidad es convertir ese conjunto en un espacio donde explorar y conservar decisiones sobre un mundo. Hay problemas independientes de calidad geográfica, coste de cálculo, presentación y persistencia; requieren soluciones distintas.

La revisión abarcó generación y drenaje, reproducción de mundos guardados, cachés, mosaicos regionales, dibujo del mapa, capas 3D, pintura, cálculo de viajes, regeneración y alternativas. Se trabajó con fixtures sintéticos, mediciones locales y un proyecto de prueba en la aplicación.

## Defectos demostrados y correcciones implementadas

| Área | Evidencia | Cambio |
|---|---|---|
| Drenaje | En 99 cuencas de prueba, la versión anterior podía procesar receptores antes de completar sus afluentes | Orden topológico y conservación del área de cuenca en el algoritmo nuevo |
| Continuidad de mundos | Cambiar un algoritmo puede desplazar el terreno bajo lugares ya creados | Recetas antiguas conservan su versión; mundos nuevos, alternativas y regeneraciones explícitas usan el drenaje corregido |
| Detalle regional | Una composición reproducible sobrescribía 511 celdas; un encuadre vertical producía 514 × 2564 pese al límite de 1024 | Dimensiones y muestreo consistentes; presupuesto aplicado a ambos ejes |
| Caché visible | Una respuesta cancelada podía expulsar una tesela que seguía en pantalla | Se descartan respuestas que ya no pertenecen a la petición activa |
| Repintado y cámara | Peticiones repetidas reservaban cuadros redundantes; vuelo ligado a 42 cuadros | Una reserva por cuadro y vuelo definido por tiempo, con prueba de RAF real |
| Capas | Cambiar capas o recibir geografía completa podía reutilizar una textura anterior | Ríos, caminos y fronteras entran en las claves de caché y se aplican al dibujo 3D |
| Ríos cartográficos | Simplificar un río recto a dos puntos podía hacerlo desaparecer | Se dibujan también tramos de dos puntos |
| Escultura | Recalcular biomas omitía restricciones, corrientes frías y sustrato volcánico | Conserva las entradas ecológicas utilizadas por la generación |
| Pintura global | Cruzar el borde longitudinal podía trazar un río/camino alrededor del planeta | Interpolación por el arco corto en ambas direcciones |
| Viajes | Rutas terrestres atravesaban lagos; barcos usaban costa seca; ciertas heurísticas no garantizaban el menor tiempo | Agua/tierra diferenciadas, embarque terminal, distancias esféricas y comparación con Dijkstra |
| Ríos creados por el autor | Un río pintado visible no era navegable | La navegación reconoce pintura, borrado y restauración sin recalcular hidrología global |
| Sustitución de un mundo | Parámetros y limpieza de ediciones se guardaban por separado | Transacción completa antes de publicar el nuevo terreno; un fallo conserva el anterior |

## Cambios en el trabajo creativo

- Entrada en mapa cenital y dibujo del terreno sin esperar a toda la geografía humana.
- Herramientas bajo el mapa cuando falta anchura y control para ampliar el espacio cartográfico.
- Indicación de ajustes pendientes y posibilidad de restablecerlos.
- Crear una alternativa independiente con los ajustes propuestos y procedencia al mundo original.
- Selector visible de mundos y acceso directo al original desde una alternativa.
- Guardar itinerarios con nombre, paradas y condiciones de viaje; recuperarlos a distintas resoluciones, avisar si cambió el terreno y retirarlos con confirmación y protección frente a cambios externos.
- Regenerar con elección explícita de conservar coordenadas o retirar chinchetas y regiones. Cambiar resolución conserva las coordenadas geográficas de las regiones retenidas.
- Guardado ordenado y reintentable de regiones antes de sustituir terreno.
- Detección de cambios externos durante la generación; se rechaza una sustitución obsoleta.

## Mediciones de rendimiento

Mediciones locales en Node 22.19, Windows x64, semilla `core-audit`, recetas de versión 1, frente al commit `2475b80881d4a6a35ae78266c788dffae17eb55e`. La tanda final usa tres parejas por operación y también tres parejas de generación completa, con medianas. No se reducen resolución, iteraciones ni detalle. Se conservan todos los campos geográficos, caminos de ríos y píxeles comparados. Son tiempos de operaciones concretas, no una medición de FPS de toda la aplicación. Evidencia final en [worldgen-benchmark-complete-2026-09-07.json](worldgen-benchmark-complete-2026-09-07.json); la primera tanda permanece en [worldgen-benchmark-2026-09-07.json](worldgen-benchmark-2026-09-07.json). El script `scripts/benchmark-worldgen.mjs` permite reproducir la comparación y añadir muestras del modelo nuevo con `--modern-samples 3`.

| Operación | Antes | Después |
|---|---:|---:|
| Generación completa, mundo de 1024 | 3,917 s | 3,284 s |
| Generación completa, mundo de 2048 | 13,500 s | 12,287 s |
| Placas, mundo de 1024 | 1255 ms | 1154 ms |
| Placas, mundo de 2048 | 4901 ms | 4498 ms |
| Dibujar ventana de 1280 × 720 sobre mundo de 1024 | 98,5 ms | 62,6 ms |
| Dibujar la misma ventana sobre mundo de 2048 | 85,9 ms | 51,8 ms |
| Miniatura de mundo de 2048 | 136,1 ms | 7,19 ms |
| Decodificar mundo de 2048 | 182,9 ms | 206,1 ms |

La generación completa mejora un 16,2 % a 1024 y un 9,0 % a 2048. La revisión reutiliza trigonometría entre octavas de ruido, reduce movimientos en el heap y optimiza la búsqueda de vecinos D8 conservando orden y empates. La erosión de 2048 baja de 4,135 a 3,125 s en medianas de sus etapas. Una prueba adicional conserva el hash completo del modelo moderno antes y después de optimizar.

La miniatura genera directamente su resolución de destino; sus buffers pasan de unos 16 MiB a 160 KiB. El snapshot nuevo conserva más información (cotas de lagos), por lo que su decodificación tarda más; evita unos 32 MiB temporales a 2048 y rechaza estructuras truncadas o desproporcionadas antes de reservar las matrices. La caché de generación aplica un presupuesto de 256 MiB y un máximo de tres mundos, permitiendo conservar un único mundo actual aunque exceda el presupuesto. La caché de recálculo conserva hasta dos estados por mundo y aplica un presupuesto global de 192 MiB, con la misma excepción para un único estado grande.

## Responsabilidades tras la reestructuración

`core/` conserva algoritmos puros y versión de drenaje. `useWorldGeneration` controla workers, cachés y publicación del resultado después de confirmar su guardado. `recipe.ts` prepara una sustitución, verifica concurrencia y guarda parámetros, ediciones y política de lugares de forma atómica; también crea alternativas. `journeyTypes.ts` conserva paradas normalizadas y la firma del terreno; `journeyOperations.ts` guarda y elimina itinerarios mediante transacciones acotadas al proyecto. `cartography/frameClock.ts` agrupa invalidaciones y define el tiempo de vuelo. Los componentes presentan el mapa y las decisiones del autor.

## Continuación implementada: las necesidades detectadas

**Recalcular después de esculpir.** La acción «Recalcular clima y ríos» deriva corrientes, temperatura, lluvia, caudales, lagos, biomas, hielo e hitos a partir del relieve actual, en un worker. Conserva terreno y capas del autor. El resultado se guarda como un punto del historial, se puede deshacer y se reproduce al reabrir. La cancelación, los errores de almacenamiento y una receta modificada externamente no publican un resultado parcial. Las derivaciones se conservan en una caché acotada; los estados antiguos se preparan de nuevo en segundo plano. Las teselas regionales invalidan también los cambios lejanos que pueden afectar a su clima.

**Hidrología absoluta.** La versión 2 incorpora lluvia anual, evaporación dependiente de temperatura y área física de cada celda. El caudal ya no pierde su magnitud por normalizarlo respecto a cada planeta. El control de densidad elige qué cauces representar sin cambiar el volumen de agua. Los lagos se contrastan con su balance de agua y un sumidero seco reduce el caudal aguas abajo. En el mismo terreno de prueba a 512, los escenarios seco, templado y húmedo producen 0, 113 y 223 ríos; variar densidad mantiene la descarga. Es un modelo anual aproximado para construir mundos, no un pronóstico hidrológico.

**Lagos en 3D.** `lakeSurface` recorre generación, transporte y almacenamiento. Las láminas de agua se dibujan a su cota en plano y globo, se recortan contra el terreno y respetan la exageración vertical. La cámara se sitúa sobre el agua. Los recortes regionales conservan un lago aunque su desagüe quede fuera del encuadre. El formato de snapshot 3 conserva las cotas exactas y sigue leyendo el formato 2.

**Legibilidad cartográfica.** La revisión aborda escala de texto durante dibujo rápido y final, límites del encuadre, tamaños relativos al área representada, colisiones de texto curvo y prioridad de los nombres creados por el autor. El rotulado regional comparte espacio con el global. Las pruebas comparan varios presets, anchuras y densidades de pantalla.

**Flujo narrativo.** «Desarrollar este viaje» parte de todo el recorrido o de una noche. El autor revisa título y contenido y decide guardarlo como idea o escena. Se conservan mundo, receta, paradas, condiciones y posición de la etapa en un vínculo de procedencia. Crear contenido, enlazarlo y habilitar su motor es una sola transacción. El borrador permanece ante fallos y durante cambios del recorrido o comparaciones; las respuestas antiguas no sustituyen datos actuales.

**Interacción al planificar.** La ruta principal, la comparación de veinte combinaciones y la descripción paleogeográfica se calculan fuera del hilo de interacción. La ruta principal llega primero; cambios de opciones, extremos o edición del mundo cancelan el trabajo anterior. Hay progreso, errores recuperables y texto ES/EN.

La comprobación con ciudades reales detectó que la familia lingüística generada contenía funciones que no podían enviarse al worker. El transporte de rutas proyecta únicamente caminos, posiciones, refugios y reinos necesarios para viajar. Una prueba con el worker real de Vite verifica la ruta, las veinte comparaciones y la descripción paleogeográfica usando un mundo generado, además de las pruebas de interfaz con transporte simulado.

**Historial en mundos grandes.** La prueba manual encontró un cierre al deshacer el recálculo de un mundo de 2048. La revisión detectó una reconstrucción completa de geografía dentro del parche de interfaz y copias temporales de unos 76 MiB por entorno. El historial reutiliza las matrices de trabajo, solicita la fuente original solo cuando necesita preparar un estado antiguo y evita volver a clasificar biomas ya calculados en un punto del historial. La prueba de reservas repite ocho ciclos de deshacer/rehacer sobre una cuadrícula de 2048 sin clonar matrices del entorno; adoptar el resultado del worker solo copia los 8 MiB de la elevación del punto de historial. Esta medida cuenta reservas concretas, no el pico de memoria de todo el proceso.

## Verificación

Las pruebas nuevas ejercitan cuencas adversariales, hashes de compatibilidad, corruptelas de caché, rásteres, cancelación, capas con píxeles reales, agua y tierra, pintura, transacciones y alternativas. Se incluyen en `test:critical` y pueden ejecutarse como conjunto mediante `test:worldgen`. El resultado final y los recorridos de interfaz quedan registrados en `tasks/todo.md`.
