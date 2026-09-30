# Publicación de versiones de escritorio

## Destino

- Repositorio público: https://github.com/Luissalet/Writers-Hoard-Releases
- Releases: https://github.com/Luissalet/Writers-Hoard-Releases/releases
- El código y el historial de desarrollo están en https://github.com/Luissalet/Writers-Hoard-Desktop, público desde el 30 de septiembre de 2026. Al repositorio de releases solo se suben paquetes, metadatos, checksums y documentación pública.
- `electron-builder.yml`, sección `publish`, configura `provider: github`, `owner: Luissalet`, `repo: Writers-Hoard-Releases`. El actualizador utiliza ese destino.

## Versión y archivos

Mantener la misma versión `X.Y.Z` en `package.json`, `package-lock.json`, los paquetes y los metadatos. El tag de release lleva prefijo `v`: `vX.Y.Z`.

La distribución Windows x64 + Linux x64 utiliza estos seis adjuntos, directamente en la release (sin meterlos en un ZIP):

| Nombre | Contenido |
| --- | --- |
| `Writers-Hoard-Setup-X.Y.Z.exe` | Instalador Windows NSIS x64 |
| `Writers-Hoard-Setup-X.Y.Z.exe.blockmap` | Actualización diferencial de Windows |
| `Writers-Hoard-X.Y.Z.AppImage` | Aplicación Linux x64 |
| `latest.yml` | Metadatos del actualizador Windows |
| `latest-linux.yml` | Metadatos del actualizador Linux |
| `SHA256SUMS.txt` | SHA256 hexadecimal de los otros cinco archivos |

Los nombres anteriores son la convención usada en 0.1.1. Si se cambia un nombre generado por el empaquetador, actualizar también `path` y `files[].url` del YAML correspondiente. Verificar `version`, `files[].size` y los SHA512 en base64 contra los binarios finales. Conservar los restantes campos generados, incluido `blockMapSize` cuando corresponda.

Formato de cada línea de `SHA256SUMS.txt`: `<sha256 hexadecimal>  <nombre del archivo>`. Generarlo después de finalizar los metadatos; no incluir el propio manifiesto dentro de sí mismo.

## Preparación y verificación

1. Actualizar versión y redactar las notas: novedades, plataformas y limitaciones conocidas. Ejemplo: `tasks/release-notes-0.1.1.md`.
2. Instalar dependencias y obtener los binarios fijados con `npm ci` y `npm run fetch:bin` en el entorno de cada plataforma. Linux necesita dependencias nativas y binarios Linux; no reutilizar `node_modules` ni recursos Windows.
3. Ejecutar `npm run verify:release`. Empaquetar con electron-builder para Windows NSIS x64 y Linux AppImage x64, usando `--publish never` durante la preparación local.
4. Comprobar los paquetes finales: arranque, versión, renderer, dependencias nativas y ausencia de fuentes/mapas propios. Windows dispone de `npm run test:packaged`; Linux requiere una comprobación separada del AppImage, con usuario no root y sandbox.
5. Reunir únicamente los seis adjuntos en `release/publish-X.Y.Z/`, comprobar los YAML y generar `SHA256SUMS.txt`.

   Desde 0.1.4 los pasos de Linux y el montaje están en `scripts/release/`: `build-linux-appimage.sh` (en `node:22-bookworm`, a partir de `git archive HEAD` guardado como `src.tar` en la carpeta montada en `/io`), `smoke-linux-appimage.sh` (en `debian:trixie`, usuario sin privilegios, espera el renderer en `127.0.0.1:5174`) y `assemble-release.py X.Y.Z <carpeta linux-out>` (copia y renombra, corrige el YAML de Linux, comprueba SHA512 y tamaños y escribe `SHA256SUMS.txt`).
6. Crear una release nueva; conservar las anteriores. Comprobar los seis adjuntos remotos, tamaños y SHA256, y que las URLs indicadas en los YAML descargan los paquetes correctos.

## Subida manual de una versión preliminar

Ejemplo de formato para 0.1.1, **ya publicada; no repetir contra esa versión**. Para otra versión, sustituir todos los números y preparar primero los archivos. Ejecutar desde la raíz del proyecto con GitHub CLI autenticado con permiso de escritura en el repositorio público:

```powershell
gh release create v0.1.1 --repo Luissalet/Writers-Hoard-Releases --draft --prerelease --title "Writers Hoard 0.1.1" --notes-file tasks/release-notes-0.1.1.md
gh release upload v0.1.1 --repo Luissalet/Writers-Hoard-Releases release/publish-0.1.1/Writers-Hoard-Setup-0.1.1.exe release/publish-0.1.1/Writers-Hoard-Setup-0.1.1.exe.blockmap release/publish-0.1.1/Writers-Hoard-0.1.1.AppImage release/publish-0.1.1/latest.yml release/publish-0.1.1/latest-linux.yml release/publish-0.1.1/SHA256SUMS.txt
gh release view v0.1.1 --repo Luissalet/Writers-Hoard-Releases --json url,isDraft,isPrerelease,assets
# Tras verificar los adjuntos del borrador:
gh release edit v0.1.1 --repo Luissalet/Writers-Hoard-Releases --draft=false
```

Si se retoma una subida interrumpida, inspeccionar primero la release existente. No sobrescribir adjuntos publicados por defecto. El tag del repositorio público es una referencia de distribución, no una razón para enviarle commits del repositorio de desarrollo.

## Automatización y firma

`.github/workflows/release.yml` se activa al subir un tag `v*` al repositorio de desarrollo o por ejecución manual. Actualmente solo compila y publica **Windows** mediante `npm run dist:publish`: no completa por sí sola los seis adjuntos de la distribución Windows/Linux.

Requiere `RELEASES_GITHUB_TOKEN` con permiso `Contents: write` en el repositorio público; el `GITHUB_TOKEN` del repositorio de desarrollo no sirve para publicar en el otro repositorio. La firma usa `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD`. `dist:publish` exige firma y activa `forceCodeSigning`; no desactivar ese control para la ruta automatizada.

Las versiones preliminares manuales 0.1.0 y 0.1.1 se publicaron sin firma Windows, con esa limitación indicada en las notas. No interpretar ese antecedente como una publicación estable firmada. Las notas de 0.1.1 también documentan la limitación de gallery-dl en Linux (GLIBC >= 2.38).

Última publicación verificada: [v0.1.4](https://github.com/Luissalet/Writers-Hoard-Releases/releases/tag/v0.1.4), 30 de septiembre de 2026. Prerelease manual Windows x64/Linux x64, seis adjuntos en `release/publish-0.1.4/`, notas en `tasks/release-notes-0.1.4.md`. La AppImage se compiló en Docker (`node:22-bookworm`, `npm ci` + `fetch:bin` Linux, desde `git archive` del commit de release) y arrancó en `debian:trixie` como usuario no root: renderer en `127.0.0.1:5174`, migración de origen «skipped» en un perfil nuevo. Windows: `verify:release` completo (366 pruebas críticas, entrada del bundle 1568.6 kB bajo el límite de 1600 kB), `test:inquiry`, `test:engines`, `test:packaged`, instalación silenciosa sobre 0.1.3 en este equipo, apertura de la biblioteca existente y comprobación en la app instalada: una fuente retirada desde la interfaz sale marcada en la vista previa de publicación y en `wh_bibliography`. Los seis adjuntos de GitHub coinciden en tamaño y SHA256 (el `digest` de la API) con `SHA256SUMS.txt`; SHA512 y tamaños de los YAML comprobados contra los binarios; los YAML y las sumas se descargan por `releases/download/v0.1.4/`. Los nombres que genera electron-builder llevan espacios (`Writers Hoard Setup 0.1.4.exe`, `Writers Hoard-0.1.4.AppImage`): se copian con guiones y se corrige `url`/`path` del YAML de Linux antes de calcular las sumas.

Anterior: [v0.1.3](https://github.com/Luissalet/Writers-Hoard-Releases/releases/tag/v0.1.3), 25 de septiembre de 2026. Prerelease manual Windows x64/Linux x64, seis adjuntos en `release/publish-0.1.3/`, notas en `tasks/release-notes-0.1.3.md`. La AppImage se compiló en Docker (`node:22-bookworm`, `npm ci` + `fetch:bin` Linux) y se arrancó en `debian:trixie` como usuario no root: renderer en `127.0.0.1:5174`, migración de origen «skipped» en un perfil nuevo. Windows: `verify:release` completo, `test:packaged`, instalación silenciosa en este equipo y apertura de la biblioteca existente. Los seis adjuntos de GitHub coinciden en tamaño y SHA256 (el `digest` de la API) con los originales; SHA512 y tamaños de los YAML comprobados contra los binarios. Primera versión que sirve el renderer empaquetado en `http://127.0.0.1:5174` y copia la biblioteca de `file://` una vez (`electron/originMigration.ts`).

Anterior: [v0.1.2](https://github.com/Luissalet/Writers-Hoard-Releases/releases/tag/v0.1.2), 8 de septiembre de 2026.

Referencia anterior: https://github.com/Luissalet/Writers-Hoard-Releases/releases/tag/v0.1.1
