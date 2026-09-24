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
