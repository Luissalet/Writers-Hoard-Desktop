# Pendientes — Writers Hoard

Fallos conocidos, cosas sin verificar y deuda aceptada a propósito.
`[!]` rompe algo hoy · `[?]` no verificado · `[~]` deuda deliberada · `[+]` mejora

---

## Rompe algo hoy

- `[!]` **Los LoRA nunca han funcionado, y además corrompían el prompt.**
  `buildSdJobPayload` inyectaba `<lora:NOMBRE:PESO>` en el texto porque un
  comentario decía que el servidor no tenía campo para ello. Pero
  `routes_sdcpp.cpp:368` pasa un directorio de LoRA vacío a
  `resolve_and_validate` con el comentario *"Intentionally disable
  prompt-embedded LoRA tag parsing for server APIs"* — así que el token **ni se
  aplicaba ni se quitaba**: llegaba al codificador de texto como palabras
  literales. Movido al campo estructurado `lora[{path, multiplier}]`.
  Verificado leyendo el parser en el commit exacto del pin.

- `[!]` **`embed_image_metadata` estaba en `false`.** La reproducibilidad
  apagada por defecto. Un PNG generado no llevaba dentro cómo se hizo.

- `[!]` **`ImageGenerationInfo` no puede reproducir una imagen.** Le faltaban
  cfg, sampler, scheduler, la lista de LoRA (viajaban dentro del prompt como
  texto: con pérdida y no consultable), el hash del fichero del modelo y el tipo
  de backend. *Iterar sobre esta imagen* y *comparar recetas* mienten sin eso.

- `[!]` **Sampler, scheduler, pasos y CFG salen de los defaults del catálogo,
  no de la petición.** El usuario no puede cambiarlos en absoluto.

---

## No verificado

- `[?]` **Nada se ha ejecutado contra un sd-server real.** No hay binario ni GPU
  en el contenedor. Todo está verificado leyendo la fuente en el commit del pin,
  no ejecutándolo.

- `[?]` **El IPC de los companions existe, pero ninguna pantalla lo llama.**
  `sd:downloadCompanion` y compañía están en `electron/ai/ipc.ts` y en el
  preload, pero la UI no ofrece instalar ControlNet/ESRGAN. Desde 2026-09-24
  el Estudio elige la ControlNet instalada (`studio/controlNet.ts`) y, si no
  hay ninguna, desactiva Generar explicando que hay que ponerla en su carpeta.

- `[?]` **Contradicción sobre Z-Image.** La ayuda del CLI no lo menciona, pero
  `src/model/diffusion/z_image.hpp` y `docs/z_image.md` existen en el pin. Las
  dos cosas pueden ser ciertas: Z-Image es un formato que se carga con
  `--diffusion-model`, no una bandera. Habría que probarlo antes de decidir si
  hace falta subir el pin.

---

## Deuda aceptada

- `[~]` **ControlNet necesita un preprocesador y no lo hay.** sd.cpp toma una
  imagen de pista ya procesada; la app no tiene extractor de canny/pose/depth,
  así que el usuario tiene que traerla hecha. Una pista sin ControlNet nombrado
  es un error duro a propósito: sd.cpp devuelve temprano si el contexto no tiene
  ninguno, y el trabajo reportaría éxito habiéndola ignorado.

- `[~]` **PhotoMaker y PuLID son banderas de arranque, no campos de petición.**
  Solo `examples/cli/main.cpp` las rellena. Cambiarlas implica reiniciar el
  servidor.

- `[~]` **`upscale_repeats` se parsea y no se lee.** El servidor lo mete en la
  estructura y nunca lo usa; solo el CLI actúa sobre él. ESRGAN se alcanza como
  `hires.upscaler`.

- `[~]` **ControlNet es SD1.5, uno solo, y bandera de arranque.** Cambiar de red
  cuesta un reinicio. Sin `start_percent`/`end_percent`.

- `[~]` **El export de dataset sale como ZIP**, no como carpeta: escribir al
  disco necesita una puerta del proceso principal que no estaba en el reparto.

- `[~]` **Las imágenes siguen en base64 dentro de Dexie.** Con cientos de PNG de
  1024²–2048² por sesión y ~90% de descarte, base64 infla un 33%, Dexie mueve la
  cadena entera en cada lectura y `zipBackup` se lo lleva todo. Ya está resuelto
  una vez en esta app: el scrapper guarda ficheros en `userData` con rutas
  relativas en Dexie y un protocolo `wh-media://`. Hacerlo **antes** del modo
  imagen es mucho más barato que después.

---

## Mejoras pendientes

- `[+]` **El grafo de conocimiento del proyecto no se ha refrescado** — el skill
  `update-project-graph` es un stub en la sesión de nube. Conviene correrlo en
  la máquina.

- `[+]` **Falta un preset SDXL fotorrealista.** Se dejó fuera a propósito por no
  poder verificar su digest con el mismo cuidado que el resto del catálogo.

---

## Resuelto en la auditoría 2026-09-24

- `.gitignore`, `package-lock.json` y `quick-note.html` ya están en git; el
  error de tipos de `BoardCanvas.tsx` ya no existe (typecheck limpio).
- Las opciones del Estudio (pose, referencias, máscara, hires, sampler…) se
  caían en la frontera IPC (`asImageRequest`); ahora llegan al servidor.

---

## Autoría local de mundos — estado 2026-10-21

No hay una decisión o respuesta pendiente de Luis en este alcance. Este cierre
no reclasifica los asuntos anteriores del archivo.

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

El seguimiento de la integración Git sigue en la tarea de coordinación y en
[OBJETIVOS](OBJETIVOS.md); es el paso pendiente de este cierre, no una decisión
trasladada a Luis ni una integración ya realizada.

Los límites de formatos JSON antiguos, publicación del dock, preparación de
modelos y herramientas locales se conservan en
[WORLD_AUTHORING](docs/WORLD_AUTHORING.md). Ninguno se amplía por extensión del
dictamen de otro flujo.

Pruebas del cierre: [verificación final](tasks/worldcraft1041-final-verification.md)
y `tasks/evidence/worldcraft1041-manual-verification.json` (revisión requerida y
lectura exacta del manual actualizado).

---

## Herramientas de mesa 1095 (ola D1) — cosas a revisar (no requieren decisión de Luis)

- `[~]` Excel: se importan valores y fórmulas de cada hoja; el formato, las
  celdas combinadas, los gráficos, las imágenes y las macros no (el informe lo
  dice). Las fórmulas con funciones que la hoja no calcula o con referencias a
  otra pestaña (`Hoja2!A1`) se guardan tal cual y se muestran como `#FORMULA!`.
- `[~]` La tirada «animada» de dados es una animación, no física 3D.
- `[~]` El compendio es el SRD 5.2 en inglés (los nombres de las entradas no se
  traducen); los estados se muestran en español.

## Escritura 1095 (ola C) — cosas a revisar (no requieren decisión de Luis)

- `[~]` Word (DOCX) del «manual de juego»: las dos columnas empiezan después de
  la portadilla, pero un título de capítulo no puede ocupar las dos columnas
  dentro de una sección de Word (lo hace en HTML/PDF y ePub). Hacerlo pediría
  una sección por capítulo.
- `[~]` Word: la imagen de cabecera WebP o AVIF no entra en DOCX (Word no las
  lee); PNG, JPEG y GIF sí. Las versalitas de apertura salen en mayúsculas
  normales en DOCX.
- `[?]` `library-create-ui` agota el tiempo también con el arnés de
  redimensionado; el flujo que prueba (crear ficha desde la Biblioteca) pasa en
  `run-workspace-library-qa`. Revisar el arnés.
- `[~]` Restaurar desde el Archivo no se puede deshacer con `wh_undo` (es una
  operación del Archivo con su propia confirmación).

## Mapas 1095 — cosas a revisar (no requieren decisión de Luis)

- `test:critical`: la prueba de notas al pie («a new note did not open its
  popover focused») falló una vez (22-10, h86) y pasó al repetirla sin cambios;
  depende del foco de la ventana mientras se usa el equipo. Vigilar.
- Al reabrir el mundo, los rótulos responden al puntero a partir del primer
  dibujo completo (una fracción de segundo).
- En QA, `capturePage` de una ventana oculta puede devolver un fotograma
  anterior del lienzo; los oráculos leen DOM, IndexedDB o píxeles del propio
  lienzo y las capturas sólo son evidencia.
- La rejilla de juego se dibuja una sola vez desde la copia del mundo que hay
  bajo el centro de la pantalla; si el tamaño en km no divide la circunferencia,
  las celdas no casan al cruzar la costura (revisión r5, comportamiento aceptado).
- La niebla y los sucesos viven en la lista de ediciones del mundo: no
  rehacen el mundo ni su geografía, pero las cachés que se indexan por la lista
  entera de ediciones (por ejemplo, la clave guardada de la receta) cambian con
  ellos. Sólo coste de rendimiento, sin efecto en el resultado (revisión r6).
- El recorrido `run-world-graph-qa` (grafo del Códex, no de mapas) falla de forma
  intermitente en «Ajustar a la vista» con la ventana estrecha: unas veces pasa
  y otras el encuadre se queda en el del ancho anterior, siempre con los mismos
  números. El DOM ya mide 662 px, así que es el ajuste encolado de React Flow
  12.10 (`fitViewQueued`, que espera a `nodesInitialized` y a un fotograma) el
  que no se aplica en la ventana oculta. Probado sin éxito: forzar fotogramas
  con `capturePage`, el evento `resize`, sustituir `requestAnimationFrame`, una
  ventana visible transparente y el renderizado `offscreen`. En una ventana
  visible el botón funciona. Siguiente paso: exponer en la vista de prueba el
  estado del store (`width`, `fitViewQueued`, `nodesInitialized`) para ver qué
  condición falta.
