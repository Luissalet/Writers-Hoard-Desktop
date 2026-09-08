# Publicación de versiones de escritorio

## Destino

- Repositorio público: https://github.com/Luissalet/Writers-Hoard-Releases
- Releases: https://github.com/Luissalet/Writers-Hoard-Releases/releases
- El código y el historial de desarrollo permanecen en el repositorio privado. Al público se suben paquetes, metadatos, checksums y documentación pública.
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

Si se retoma una subida interrumpida, inspeccionar primero la release existente. No sobrescribir adjuntos publicados por defecto. El tag del repositorio público es una referencia de distribución, no una razón para enviarle commits privados.

## Automatización y firma

`.github/workflows/release.yml` se activa al subir un tag `v*` al repositorio de desarrollo o por ejecución manual. Actualmente solo compila y publica **Windows** mediante `npm run dist:publish`: no completa por sí sola los seis adjuntos de la distribución Windows/Linux.

Requiere `RELEASES_GITHUB_TOKEN` con permiso `Contents: write` en el repositorio público; el `GITHUB_TOKEN` del repositorio privado no sirve para publicar en el otro repositorio. La firma usa `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD`. `dist:publish` exige firma y activa `forceCodeSigning`; no desactivar ese control para la ruta automatizada.

Las versiones preliminares manuales 0.1.0 y 0.1.1 se publicaron sin firma Windows, con esa limitación indicada en las notas. No interpretar ese antecedente como una publicación estable firmada. Las notas de 0.1.1 también documentan la limitación de gallery-dl en Linux (GLIBC >= 2.38).

Referencia publicada: https://github.com/Luissalet/Writers-Hoard-Releases/releases/tag/v0.1.1
