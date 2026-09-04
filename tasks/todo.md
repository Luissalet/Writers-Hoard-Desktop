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

---

# Contract S1 — the studio foundations (branch `st-foundations`)

Same pinned runtime: stable-diffusion.cpp `master-709-92a3b73`
= commit `92a3b73cdba6d17efa30689e43857a30582c8b33`.

## Step 0 — re-establish the field names from the parser, not the docs

`examples/server/api.md` and `docs/api.md` do NOT exist at this commit, so the
earlier pass's citation of `api.md` could not have been read there. Everything
below was taken from source fetched at the pinned SHA:

- `examples/common/common.cpp` — `SDGenerationParams::from_json_str`, the
  parser that decides which keys have an effect. THE authority.
- `examples/server/routes_sdcpp.cpp` — `make_img_gen_defaults_json`, the
  server's own statement of the same schema. Independent cross-check.
- `examples/common/common.h` — the `SDGenerationParams` struct.
- `include/stable-diffusion.h` — the enums.
- `src/stable-diffusion.cpp` — `sample_method_to_str`, `scheduler_to_str`,
  `hires_upscaler_to_str`.
- `src/core/util.cpp`, `src/runtime/guidance.cpp` — the `extra_sample_args`
  key=value grammar and the APG keys.
- `thirdparty/stb_image_write.h` — the PNG `tEXt` keyword.

## Plan

- [x] S1-1 Widen the payload to everything `from_json_str` reads.
- [x] S1-2 The Recipe: versioned, hashable, replayable, stored at Dexie v30.
- [x] S1-3 PNG round trip, ours beside A1111's, plus recovery from a foreign file.
- [x] S1-4 Verify multi-LoRA (already correct) and kill the stale comments.
- [x] S1-5 Runtime profiles: one launch identity, one hash, a visible cost.
- [x] S1-6 Companion IPC across handler, allowlist, preload and renderer types.
- [x] Tests in `tests/ai-runtime.ts`, `tests/critical.browser.ts`.
- [x] `tsc` (electron + renderer) and eslint clean on every touched file.

## Review

Shipped, each verified against the source above:
`clip_skip`, `sample_params.{eta, flow_shift, shifted_timestep, custom_sigmas,
extra_sample_args}`, `guidance.{img_cfg, slg{...}}`,
`hires.{target_width, target_height, custom_sigmas}`, `vae_tiling_params`,
`cache_mode`, `cache_option`.

Deliberately NOT shipped, because the strings do not occur anywhere in the
runtime's source at this commit and the server would have accepted them and
done nothing: `ad_model` / `ad_prompt` / `ad_negative_prompt` / `extra_ad_args`
(there is no ADetailer pass), `ip_adapter_image` / `ip_adapter_strength` (no
IP-Adapter), `guidance_schedule`. PhotoMaker and PuLID have struct fields but
`from_json_str` never reads them — they are launch-time only.

Corrections to the capability matrix this contract was written from:
18 samplers, not 21. 12 schedulers, not 16. `hires` takes `target_width` /
`target_height`, not `target_w` / `target_h`. `eta` and `flow_shift` live
inside `sample_params`, not at the top level. `extra_sample_args` is a
key=value STRING, not an object.

Latent bug found and fixed on the way: the upscalers folder was not part of the
server's launch identity, so an ESRGAN installed while the server was running
never got `--hires-upscalers-dir` until an unrelated change restarted it — and
every hires pass naming that model was refused in the meantime.

Not done, and why: `sd-cli -M metadata`. `electron/ai/sdRuntimeManifest.ts`
declares only `serverBinary`; no CLI binary name is pinned for any platform and
guessing one would be inventing a file name. It is also unnecessary — 
`readPngMetadata` + `readSdcppRecord` + `recoverRecipe` read a foreign PNG in
pure TypeScript, with no process to spawn and no runtime install required.
