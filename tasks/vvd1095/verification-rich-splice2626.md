# Una sola proyección para un empalme de texto enriquecido

La tarea 2626 evita una proyección intermedia al preparar un único empalme de texto en un campo sin bloques. La preparación conserva la validación de la acción, la proyección final y la copia propia del plan. Los lotes del mismo campo, las operaciones de bloques y las otras acciones mantienen su recorrido. El refresco eliminado generaba claves temporales que el plan final reemplazaba; las claves persistidas siguen identificando sus contribuciones.

## Medición

Mismo Node 22.19.0 y oráculo SDK de 100 gestos sobre 10.000 unidades UTF-16, con el historial retenido. Se midieron dos pares sin perfilador en órdenes opuestos. El percentil 95 incluye capturar y aplicar cada gesto.

| Orden | Base p95 | Candidato p95 |
| --- | ---: | ---: |
| Base, candidato | 331,69 ms | 312,39 ms |
| Candidato, base | 330,48 ms | 299,47 ms |

Los cuatro procesos terminaron en EOF 0, con 1.115 comprobaciones, 100 actualizaciones y recibos distintos, cinco réplicas destruidas y lectura fría con las identidades correctas. Las pruebas adicionales pasaron seis grupos de proyección y reentrada, 34 comprobaciones de propiedad de bindings, 12 de fallback y 65 de bordes de texto rico. La verificación rápida también terminó en EOF 0.

El perfil previo sobre la base señaló dos proyecciones durante la preparación. Sus muestras sirven para localizar coste; la tabla usa las ejecuciones sin perfilador. Los recibos están en el seguimiento de 2318, hilo 2566 de Ágora. Estas medidas corresponden al SDK en memoria. Sigue abierta la aceptación de 100 ms con 50.000 unidades y el rendimiento interactivo en Browser.
