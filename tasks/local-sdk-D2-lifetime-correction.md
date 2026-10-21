# D2-1 — corrección de cliente documental emitido

Estado: corrección congelada para repetición independiente; pruebas propias de lifetime, servicio, transporte y UI normal PASS, cinco adapters Base/era PASS10. No D3 ni nueva declaración de paridad.

El informe independiente anterior se conserva íntegro: `work/worldcraft1041-D2-independent-review.md`, SHA256 f0750fd853293cf57d48abd0b092978798973b7007b0cc3b5cb34c0e3b4dfa2a. El proof D2 anterior permanece byteidéntico (SHA256 be95e8e0e62be3c8fe3912797ddfcd424fb1d17d65679e53a1be1810a835bff7). No se modifica ningún oráculo independiente. El diagnóstico3contextos original SHA256 e170c852f31494c1a3940aab098f0f880f0d0d898f2ea6644fd9a6adf34d9dc0 volvió a fallar antes del parche: readonly, retarget y unmount guardaban round99 desde round1; log `work/local-sdk-D2-fixes/independent-before.log`.

Causa: el cliente emitido tenía readOnly=false fijo y sobrevivía al host. El cambio crea una lease irrevocable por setup comprometido del host, con cliente propio para cada setup incluido StrictMode. Cleanup revoca ese cliente; un setup nuevo no reactiva el anterior. `LocalToolClientOptions.isCurrent` es una callback opcional en memoria, no dato portable ni permiso/backend nuevo. Sólo el host la proporciona. Storage comprueba al entrar y en los límites asíncronos de su propio writer save/state antes de completar RW. Los clientes native/headless sin lease mantienen su API. Tools delegados se comprueban antes de dispatch; no se pretende revertir un commit/efecto externo ya completado fuera de esa RW.

Sólo producto `src/engines/local/documents/LocalToolDocumentHost.tsx` y `src/engines/local/storage.ts`; documentación y un fixture propio adicional. Sin middleware ni store/overlay nuevo.

Pruebas propias:

- Oráculo independiente3casos intacto: PASS después; `work/local-sdk-D2-fixes/independent-after.log`. El fixture adicional comprueba también datos reales exactos, no sólo respuesta.
- `testDocumentHostLease`3grupos: readonly false→true→false; retarget A/B; unmount/remount bajo StrictMode; viejo cliente rechaza permanentemente y nuevo escribe. Tres hosts mismoID editor/embed/fullscreen tienen leases independientes; cerrar peers no revoca editor. RW realmente encolada y revocación durante update antes de commit rechazan sin mutación; cliente fresco aplica/deshace normalmente.
- Normal transporte documental4 y owned4 PASS; D1 servicio4; SDK6 y releases4; A headless5/C headless4; owned lifetime2. Logs normales en `work/local-sdk-D2-fixes/`.
- Renderer tsc y lint de ambos archivos PASS; no reglas suprimidas.

La aprobación sigue siendo responsabilidad de la repetición independiente. Se añadirá proof de corrección nuevo; el snapshot previo y sus FAIL no se reemplazan.


Cierre propio antes de re-review:

- Los dos oráculos independientes intactos PASS (`independent-after.log`, `independent-original-after.log`), con sus SHA originales comprobados. La captura readonly posterior muestra Round1; no se reemplaza la anterior Round99.
- `testDocumentHostLease` PASS3 tras el parche final, con rechazo permanente, peers legítimos, RW encolada y rollback durante update antes de commit. Logs `lease-after.log`.
- Normal source UI4, sourcehost3, focused5×Base/era10 y Book2 PASS; transport documental4/owned4 y lifetimeowned2 PASS. `documents-ui-after-final.log`, `host-ui-after.log`, `focused-ui-after.log`, `book-after.log` y demás logs del mismo directorio contienen el resultado exacto. Typecheck renderer/lint final de los dos archivos PASS.
- Se conservan dos repeticiones UI D1 fallidas en puntos distintos (`documents-ui-after.log`, `documents-ui-after-repeat.log`), como ya ocurrió en el primer cierre D2. No se modificó ese fixture ni se cambió producto para evitar sus aserciones. El mismo fixture intacto con observador QA de eventos/valores DOM PASS4 (`documents-ui-diagnostic.log`), y la repetición final normal sin wrapper también PASS4. No se afirma una causa definitiva de esas intermitencias ni se ocultan los FAIL.
- Runner diagnóstico sólo QA `tests/local-tool-document-regression-diagnostic.runner.cjs`: carga el fixture normal intacto, observa input/click y valores sintéticos, no cambia ejecución/validación ni respuestas. Oráculos independientes y proof previo conservados byteidénticos.
- Capturas nuevas en `work/local-sdk-D2-fixes/captures/`, preservando las originales de D2. Inspeccionadas readonly Round1 y sourcehost640; cinco adapters1440/640 capturados otra vez. No otra sesión UI queda activa.

Nuevo proof separado: `tasks/evidence/local-sdk-D2-lifetime-correction-proof.json`. No commits, D3 aún pendiente. Root debe repetir/revisar; este addendum describe verificación propia y no sustituye su verdict.
