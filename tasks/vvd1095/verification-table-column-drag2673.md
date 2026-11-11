# Arrastrar columnas en una tabla normal

En Tablas, arrastra el nombre de una columna normal hacia la mitad izquierda o derecha de otra cabecera para colocarla antes o después. La guía marca el destino. Suelta fuera o pulsa Escape para cancelar. El clic breve sigue ordenando y la edición de cálculos conserva la inserción de referencias desde la cabecera. Las hojas y vistas vivas conservan sus controles.

Writer guarda el orden de columnas en el ámbito donde se hizo el cambio. El movimiento compara el orden de columnas visto al iniciar el gesto y mantiene sus IDs y celdas. Las reglas de agrupación, filtro y orden siguen vinculadas a esos IDs.

## Evidencia por corte

- **VVD, comparación pública.** Brave 3 arrastró Hold tras Souls en la tabla de ejemplo. El orden cambió de Hold, People, Souls, Sworn to a People, Souls, Hold, Sworn to. En una vista viva sintética, el gesto de Name a Type dejó la cabecera igual. La observación se limita a esas vistas. `PLAN-r1.md` (`3d81f0a6`). [Tabla pública de VVD](https://beta.vvd.world/tools/table)
- **Writer, Brave 3 r2.** El clic en People activó el orden ascendente. El arrastre de Region tras Hold mostró la guía y el orden se conservó en una recarga por HMR. Con el candidato final, mover Region antes de People mostró la otra guía y conservó la celda Name de High Oak Ω y la agrupación visible. Escape, soltar fuera y un destino adyacente que mantendría el orden dejaron la cabecera igual. En QA Later Ω se movió Hold antes de Region. Al volver a Base se conservó su orden. `BRAVE2673-r2.md` (`c6723fb2`).
- **Focal.** Pasaron los cinco casos de proyección y búsqueda, más las comprobaciones de movimiento a ambos lados, rechazo de un orden desactualizado, celda preservada y guardas de ámbito. Focal, Quick y build terminaron con EOF 0. `FOCAL2673-r1.log` (`b58a0cb7`), `QUICK2673-r2.log` (`8e21eeb6`), `BUILD2673-r2.log` (`b800e560`).

La revisión CAS 1 aprobó `a7f38f8fc732927fef67a7b324e0205651fe6cd9` y Source se integró en Main por fast-forward sin push. El Manual de Google recibió una inserción verificada de 199 unidades UTF-16, con las listas preservadas. Recibos en `Research/writer-parity-20261110/table-column-drag`, incluidos `MERGE2673-RESULT-r1.json` (`9246292b`) y `GOOGLE-MANUAL2673-r1.json` (`9f46ebe0`). La prueba en navegador cubre el gesto, el orden y el ámbito. El comportamiento de fórmulas y el orden manual en vistas vivas quedan fuera de ese ensayo.
