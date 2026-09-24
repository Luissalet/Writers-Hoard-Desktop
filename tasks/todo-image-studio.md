# The Studio — the controls the runtime has always had

Contract S2. The bundled stable-diffusion.cpp build serves 18 sampler names,
12 scheduler names, a native hires pass, LoRA arrays, img2img, inpainting and
ControlNet. The studio exposed eight knobs and read sampler/steps/CFG from
catalogue defaults nobody could change. This is the level in between.

Files: `src/engines/image-studio/**`, `src/locales/{en,es}.ts`, `tests/image-studio.ts`.
Not mine: `src/services/aiRuntime/**`, `electron/**`, `src/types/**`, `src/db/**`,
`src/services/visualRef/**`.

## Plan

- [x] S-0  Widen `REQUEST_SUPPORTS` to every field the studio wants to send, and
      flip the two the runtime branch has already landed (`sampler`, `scheduler`).
      Wire `refImages` / `controlImage` / `maskImage` / `hiresFix` through
      `startGeneration` — today they are built and dropped.
- [x] S-1  Three levels of disclosure (Simple / Studio / Expert), remembered per
      project. Every parameter belongs to exactly one level.
- [x] S-2  A per-model capability descriptor: one place that says, per field,
      enabled or refused AND why. `parameterVisibility` becomes a view of it.
- [x] S-3  Curated samplers and schedulers over the runtime's real vocabulary,
      each with the one line that says what it is FOR, plus "show all" at Expert.
- [x] S-4  Family-aware defaults applied on model switch, with the "why" visible
      and a one-click undo.
- [x] S-5  Resolution buckets per family; an off-bucket size is named as one.
- [x] S-6  The pass chain as a first-class editable list: base → hires → detail
      → upscale, reorderable, each pass with its own prompt, denoise and toggle.
- [x] S-7  The LoRA stack: N LoRAs, weights, toggles, search, trigger words.
- [x] S-8  Seed discipline: lock, from image, incremental vs fixed batch.
- [x] S-9  Prompt craft: A1111 weighting on a selection, a token estimate with
      chunk boundaries, client-side wildcards, a fragment palette.
- [x] S-10 X/Y/Z plot: 1–3 axes, a job matrix, a labelled grid.
- [x] S-11 Tests in `tests/image-studio.ts`, wired into `critical.browser.ts`.
      The no-backend state is tested FIRST.
- [x] S-12 `tsc` (renderer + electron), lint, conformance.

## Rules this work is held to

- A parameter the model cannot honour is visible, disabled and carries its
  reason in the text. Never hidden.
- Never offer what the backend cannot honour: no prompt scheduling, no BREAK,
  no variation seed — sd.cpp does none of them, and a silently different image
  is worse than an absent feature.
- Every string through both locale files.

## Review

All twelve items shipped. `npm run conformance` passes with 4 212 locale keys;
both typechecks are clean apart from the pre-existing `BoardCanvas.tsx` error;
`eslint src/engines/image-studio tests/image-studio.ts` is clean; the critical
harness runs 143 tests including the fifteen new ones.

### What went live today rather than waiting

The support table earned its keep on the first day: `sampler` and `scheduler`
had landed on `AiImageRequest`, so the two `false` entries stopped compiling
and named their own lines. Flipping them turned the sampler and scheduler
pickers from decoration into controls.

Four more fields turned out to be carried by the request already and were
being built and dropped on the floor between the studio and the gateway:
`refImages`, `controlImage` + `controlStrength`, `maskImage` and `hiresFix`.
The identity references a writer had pinned and the pose they had chosen were
never reaching the server. They do now — but only since the 2026-09-24
audit: `electron/ai/ipc.ts` `asImageRequest` rebuilt the request from 14
fields and dropped the rest until commit 59aef88.

Still waiting on the runtime branch, all of them visible and disabled with the
sentence «the request has no field for this yet»: CLIP-skip, the detailer
pass, custom sigmas, SLG, APG and the inference cache.

### Two refusals that are not "not yet"

- The **variation seed** says stable-diffusion.cpp has no subseed. The usual
  approximation — re-noising the latent by hand — makes a different picture
  and calls it a variation.
- The **upscale pass** says this build has no standalone upscale job and that
  Real-ESRGAN is reachable through the hires pass instead. `upscale_repeats`
  is parsed by the server and then read only by the CLI.

Neither is hidden, because a writer who has read about either needs to find
out where it went rather than conclude the program has never heard of it.

### Two bugs the tests found

- A batch of four was issued as four calls and landed in the results grid as
  four batches of one, so the grid claimed the writer had pressed generate
  four times. Every picture of one press now shares a stamp.
- An X/Y/Z plot did the same for every cell, which turned a grid into a column
  of single pictures. One stamp per plot, one seed per plot, and each cell's
  axis values ride on the row so the grid is labelled.

### Not built, and why

- **A wildcard file store and a drag-to-compose fragment palette.** This
  engine owns exactly one table and adding another means a Dexie version in
  `src/db/**`, which belongs to another contract. Reusable prompt blocks are
  visual references of kind `style` instead: they compose through `@mention`
  and are addressable as `__name__` wildcards, with no schema change and no
  second place for the same idea to live.
- **A mask editor.** The request can carry `maskImage`; there is nowhere in
  the studio to paint one. The inpainting control says exactly that, which is
  a different sentence from "this model cannot inpaint".
- **Prompt scheduling and BREAK.** sd.cpp implements neither. They are not
  offered, and the composer now names them when it sees one typed, because a
  writer who has read an A1111 tutorial will type both.
