# Pendientes — Writers Hoard

Sólo lo que necesita una decisión, una respuesta o una acción física de Luis.
Las mejoras implementables, los límites aceptados y los fallos abiertos en
otros carriles están en [OBJETIVOS](OBJETIVOS.md) («Mejoras y límites
conocidos trasladados desde PENDIENTES — 04-11-2026»).

## Decisiones de Luis

Ninguna a 04-11-2026.

## Cerrado en la revisión del 04-11-2026

- LoRA por el campo estructurado `lora[]`, `embed_image_metadata: true`,
  `ImageGenerationInfo` con cfg/sampler/scheduler/LoRA/hash/backend y
  sampler/scheduler/pasos/CFG por petición (con control en el Estudio,
  `ParametersColumn`): comprobado sobre el sd-server real del pin con
  `npm run test:sd-live` (a6827d3).
- La UI de companions existe (`ImageCompanions.tsx`, Ajustes de IA y arreglo
  en el Estudio) y pasa `tests/image-companions.browser.tsx` (7/7).
- `library-create-ui`: la prueba esperaba el formulario antes del selector de
  tipo nuevo; corregida y 4/4 en verde (699bb93).
- El grafo del proyecto vive en `docs/PROJECT_KNOWLEDGE.md`; el skill
  `update-project-graph` apuntaba a una sesión de nube que ya no existe.
- Autoría local de mundos, lote1095 y C42: integrados en main (216c11f y
  sucesores); sus registros siguen en `tasks/`.
