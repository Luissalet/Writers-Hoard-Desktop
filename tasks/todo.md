# Contract W-A — expose the image runtime we already ship

Pinned runtime: stable-diffusion.cpp `master-709-92a3b73`
= commit `92a3b73cdba6d17efa30689e43857a30582c8b33`.

## Step 0 — establish the real server field names (done)

Source of truth, read at that exact commit:

- `examples/server/api.md` — the native `sdcpp` request schema.
- `examples/common/common.cpp` `SDGenerationParams::from_json_str` — the
  parser that actually decides which keys have an effect.
- `examples/server/routes_sdcpp.cpp` — how img_gen requests are parsed.
- `examples/server/async_jobs.cpp` — what `embed_image_metadata` does.
- `src/stable-diffusion.cpp` — the sampler / scheduler / hires-upscaler name
  tables the server validates against.

## Plan

- [x] W-A1 Confirm every server field name against the parser, not the CLI.
- [x] W-A2 Widen `AiImageRequest` + `buildSdJobPayload` (additive).
- [x] W-A2b Fix the LoRA path: this build does NOT parse `<lora:…>` from a
      server request. Move to the structured `lora[]` field.
- [x] W-A3 `embed_image_metadata: true` + `src/services/imageMetadata.ts`.
- [x] W-A4 Widen `ImageGenerationInfo` so a row can reproduce its image.
- [x] W-A5 Catalogue: FLUX.1-Kontext-dev Q4 + ControlNet / ESRGAN companions,
      each pinned by size and SHA-256.
- [x] Launch side: `--control-net`, `--hires-upscalers-dir`.
- [x] Tests in `tests/ai-runtime.ts` (the harness this repo actually runs).
- [x] `npx tsc --noEmit` (renderer + electron) and the linter.

## Review

See the closing report. Shipped only fields confirmed in the parser;
PhotoMaker and `upscale_repeats` were confirmed inert on the server and were
deliberately left out.

## What shipped, and what did not

Confirmed in `SDGenerationParams::from_json_str` and shipped:
`ref_images`, `increase_ref_index`, `auto_resize_ref_image`, `control_image`,
`control_strength`, `mask_image`, `hires.*`, `lora[].path` / `[].multiplier`,
`embed_image_metadata`, `sample_params.sample_method` / `.scheduler`.

Confirmed inert on the server and therefore NOT shipped:
- PhotoMaker identity images — no request field exists; `pm_id_images` is
  filled only by `examples/cli/main.cpp`.
- `upscale_repeats` — parsed into the struct, then read only by the CLI.
  ESRGAN is reachable through `hires.upscaler` instead.
- A per-request ControlNet model — `--control-net` is a context option, so it
  is a launch argument and a change restarts the server.

The renderer-facing IPC for installing companions is deliberately not wired:
`electron/ai/ipc.ts` belongs to the studio work, not to this contract. The
main-process entry points are `downloadSdCompanion`, `cancelSdCompanionDownload`,
`deleteSdCompanion` and `installedSdCompanions`.
