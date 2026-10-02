# Writers Hoard 0.1.5: personajes, storyboards y mundos entre apps de la familia

Versión preliminar para Windows x64 y Linux x64.

## Al actualizar desde 0.1.4

La base de datos no cambia de versión. Los proyectos existentes se abren tal cual.

## Novedades

- **Enviar a Prospero.** Un personaje del Codex pasa al reparto de Prospero's Hoard con su ficha, rasgos físicos, retrato y hasta tres imágenes de la galería. Un storyboard pasa como producción, con los planos en orden, su descripción, duración e imagen (hasta 40).
- **Mundos compartidos con Scheherazade.** «Enviar a Scheherazade» exporta el mundo del proyecto en el formato común `hoard.world/1`; «Traer de Scheherazade» lo importa.
  - La importación crea registros nuevos y nunca pisa lo que hayas editado aquí.
  - Lo que borraste a mano no vuelve en la siguiente importación.
  - Cada registro importado guarda de dónde viene y su versión.
  - Se puede deshacer.
  - Los registros secretos no se envían.
- **Puente de IA:** 145 herramientas. Cuatro nuevas: `wh_character_to_prospero`, `wh_storyboard_to_prospero`, `wh_world_to_scheherazade` y `wh_world_from_scheherazade`.
- Las llamadas a otras apps pasan por el Hoard Hub local. Si el Hub o la otra app no están abiertos, el aviso dice cuál abrir.

## Descargas y requisitos

- **Windows x64:** `Writers-Hoard-Setup-0.1.5.exe`. Instalador preliminar sin firma digital, como las versiones anteriores.
- **Linux x64:** `Writers-Hoard-0.1.5.AppImage`. Concede permiso de ejecución. Las herramientas multimedia completas requieren glibc 2.38 o posterior; gallery-dl no funciona con glibc 2.36.
- **SHA256SUMS.txt:** sumas de comprobación. Los archivos `.yml` y `.blockmap` sirven al actualizador.
- Las entregas a Prospero y Scheherazade necesitan el Hoard Hub y esas apps en el mismo equipo.

## Validación

Pasan las pruebas críticas, la comprobación de tipos, el lint, la conformidad de los engines, las pruebas de la familia (intercambio de mundos, importación, deshacer e interfaz) y las de suscripciones.

El paquete de Windows arranca instalado sobre 0.1.4 y abre la biblioteca existente. La AppImage se compiló en Docker (`node:22-bookworm`) y arranca en `debian:trixie` con un usuario sin privilegios.

Los archivos «Source code» generados por GitHub contienen la documentación pública del repositorio de releases. El código fuente está en https://github.com/Luissalet/Writers-Hoard-Desktop.
